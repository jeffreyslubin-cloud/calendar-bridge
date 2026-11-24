// One-time diagnostic file in Drive appDataFolder. No calendar or production
// history operations. Runs only after the user clicks its separate button.
(function(root) {
'use strict';
const NAME = 'calendar-bridge-storage-diagnostic-v1.json';
const MARKER = 'calendar-bridge-storage-check-v1';
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
async function check(fetchFn, token) {
    if (typeof fetchFn !== 'function' || !token) throw Error('Missing Google Drive authorization.');
    async function request(url, options = {}) {
        const response = await fetchFn(url, {
            ...options,
            cache: 'no-store',
            headers: { Authorization: 'Bearer ' + token, ...(options.headers || {}) }
        });
        if (!response || !response.ok) throw Error('Google Drive returned HTTP ' + (response?.status || 'unknown'));
        return response;
    }
    async function discover() {
        let next = '';
        const found = [];
        do {
            const url = new URL(API);
            url.searchParams.set('spaces', 'appDataFolder');
            url.searchParams.set('q', "name = '" + NAME + "' and trashed = false");
            url.searchParams.set('fields', 'nextPageToken,files(id,name)');
            url.searchParams.set('pageSize', '100');
            if (next) url.searchParams.set('pageToken', next);
            const data = await (await request(url.toString())).json();
            if (!Array.isArray(data.files)) throw Error('Drive returned an invalid file listing.');
            found.push(...data.files.filter(f => f.name === NAME));
            if (found.length > 1) throw Error('Multiple diagnostic files exist. No changes made.');
            next = data.nextPageToken || '';
        } while (next);
        return found[0] || null;
    }
    async function verify(id) {
        const data = await (await request(API + '/' + encodeURIComponent(id) + '?alt=media')).json();
        if (!data || data.marker !== MARKER || data.version !== 1 || data.purpose !== 'test-only') {
            throw Error('Diagnostic content mismatch. No changes made.');
        }
        return true;
    }
    let entry = await discover();
    if (entry) {
        if (!entry.id) throw Error('Diagnostic file has no identifier.');
        await verify(entry.id);
        return { state: 'verified-existing' };
    }
    // Double-check before first creation to minimize accidental duplicates.
    if (await discover()) throw Error('Diagnostic file appeared during check. Retry.');
    const body = JSON.stringify({marker:MARKER, version:1, purpose:'test-only'});
    const boundary = 'calendarbridgecheck' + crypto.randomUUID().replace(/-/g, '');
    const metadata = JSON.stringify({name:NAME, parents:['appDataFolder'], mimeType:'application/json'});
    const multipart = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
        metadata + '\r\n--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
        body + '\r\n--' + boundary + '--\r\n';
    const response = await request(UPLOAD + '?uploadType=multipart&fields=id', {
        method:'POST',
        headers:{'Content-Type':'multipart/related; boundary=' + boundary},
        body:multipart
    });
    const created = await response.json();
    if (!created?.id) throw Error('Drive did not confirm diagnostic creation. Do not retry automatically.');
    await verify(created.id);
    const latest = await discover();
    if (!latest || latest.id !== created.id) throw Error('Diagnostic duplicate or inconsistency; inspect before retry.');
    return { state:'created-and-verified' };
}
const api = { NAME, MARKER, check };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.CalendarBridgeStorageDiagnostic = api;
})(typeof window !== 'undefined' ? window : globalThis);
