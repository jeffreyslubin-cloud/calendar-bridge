// Google Drive appDataFolder append-only snapshot store.
// NOT linked into extension UI. No calendar writes. This is a prototype for
// backup/recovery; multi-device writes remain disabled until race-safe locking
// and recovery are implemented and live tested.
(function(root) {
'use strict';
const PREFIX = 'calendar-bridge-snapshot-v1-';
const BASE = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
function makeStore(fetchImpl, token, journal, uuid) {
    if (typeof fetchImpl !== 'function' || !token || !journal ||
        typeof uuid !== 'function') throw Error('Missing Drive journal dependencies');
    // Only cache immutable snapshots when Drive supplies a content checksum
    // and modification timestamp. If metadata changes, stop rather than
    // silently trusting stale history.
    const snapshotsCache=new Map();
    async function request(url, options = {}) {
        const response = await fetchImpl(url, {
            ...options, cache: 'no-store',
            headers: {Authorization: 'Bearer ' + token, ...(options.headers || {})}
        });
        if (!response?.ok) throw Error('Drive journal request failed: HTTP ' + (response?.status || 'unknown'));
        return response;
    }
    async function listFiles() {
        const list = [];
        let next = '';
        do {
            const url = new URL(BASE);
            url.searchParams.set('spaces', 'appDataFolder');
            url.searchParams.set('q', "name contains '" + PREFIX + "' and trashed = false");
            url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,modifiedTime,md5Checksum,size)');
            url.searchParams.set('pageSize', '1000');
            if (next) url.searchParams.set('pageToken', next);
            const page = await (await request(url.toString())).json();
            if (!Array.isArray(page.files)) throw Error('Invalid Drive journal listing');
            list.push(...page.files.filter(f => f.name?.startsWith(PREFIX)));
            next = page.nextPageToken || '';
        } while (next);
        if (list.length > 2000) throw Error('Excessive history snapshots; maintenance needed');
        return list;
    }
    async function read(accountId, calendarId) {
        if (!accountId || !calendarId) throw Error('Missing account or calendar identity');
        const entries = await listFiles();
        const snapshots = [];
        for (const f of entries) {
            if (!f.id) throw Error('Invalid snapshot file ID');
            const signature=f.modifiedTime && f.md5Checksum ?
                [f.modifiedTime,f.md5Checksum,String(f.size||'')].join(':') : null;
            const prior=snapshotsCache.get(f.id);
            if(prior && signature && prior.signature!==signature)
                throw Error('Previously saved history snapshot was modified; recovery required');
            let data;
            if(prior && signature && prior.signature===signature) {
                data=prior.data;
            } else {
                data=await (await request(BASE + '/' + encodeURIComponent(f.id) +
                    '?alt=media')).json();
                if(signature)snapshotsCache.set(f.id,{signature,data});
            }
            snapshots.push({fileId:f.id,data});
        }
        return journal.resolve(snapshots, accountId, calendarId);
    }
    async function append(expectedFileId, history, accountId, calendarId) {
        journal.validHistory(history);
        if (history.accountId !== accountId || history.calendarId !== calendarId) {
            throw Error('History identity mismatch');
        }
        const prior = await read(accountId, calendarId);
        const headId = prior.head?.fileId || null;
        if (headId !== expectedFileId) throw Error('History changed; abort and reload');
        const generation = prior.state === 'uninitialized' ? 0 : prior.head.data.generation + 1;
        const data = journal.snapshot(generation, headId, history, new Date().toISOString());
        // Each generation is an immutable file. A future read will detect forks.
        const name = PREFIX + String(generation).padStart(7, '0') + '-' + uuid() + '.json';
        const boundary = 'cb_' + uuid().replace(/[^a-zA-Z0-9]/g, '');
        const meta = JSON.stringify({name, parents:['appDataFolder'], mimeType:'application/json'});
        const body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
            meta + '\r\n--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
            JSON.stringify(data) + '\r\n--' + boundary + '--';
        const response = await request(UPLOAD + '?uploadType=multipart&fields=id', {
            method:'POST', headers:{'Content-Type':'multipart/related; boundary=' + boundary}, body
        });
        const result = await response.json();
        if (!result.id) throw Error('Drive did not confirm snapshot creation');
        // Even success is not permission to run calendar writes. Re-read to
        // check for competing snapshots and fail if another writer raced.
        const checked = await read(accountId, calendarId);
        if (checked.head?.fileId !== result.id) throw Error('Snapshot race; recovery required');
        return {fileId:result.id, generation};
    }
    return {listFiles, read, append};
}
const api = {PREFIX, makeStore};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.CalendarBridgeDriveJournal = api;
})(typeof window !== 'undefined' ? window : globalThis);
