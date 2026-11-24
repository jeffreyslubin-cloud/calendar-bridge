// Isolated Drive appDataFolder storage adapter, not yet wired into the UI.
// Requires the drive.appdata OAuth scope and enabled Drive API before use.
// This module is not referenced in manifest/popup and cannot run on its own.
(function(root) {
'use strict';
const FILE_NAME = 'calendar-bridge-history-v1.json';
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const encode = encodeURIComponent;
function makeStore(fetchImpl, token) {
    if (typeof fetchImpl !== 'function' || !token) throw Error('Drive requires fetch and OAuth token');
    async function request(url, options = {}) {
        const response = await fetchImpl(url, {
            ...options, cache: 'no-store',
            headers: { Authorization: 'Bearer ' + token, ...(options.headers || {}) }
        });
        if (!response || !response.ok) throw Error('Drive request failed, HTTP ' + (response?.status || 'unknown'));
        return response;
    }
    async function find() {
        let pageToken = '';
        const matches = [];
        do {
            const url = new URL(API);
            url.searchParams.set('spaces', 'appDataFolder');
            url.searchParams.set('q', "name = '" + FILE_NAME + "' and trashed = false");
            url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType)');
            url.searchParams.set('pageSize', '100');
            if (pageToken) url.searchParams.set('pageToken', pageToken);
            const payload = await (await request(url.toString())).json();
            if (!Array.isArray(payload.files)) throw Error('Unexpected Drive file listing');
            matches.push(...payload.files.filter(f => f.name === FILE_NAME));
            pageToken = payload.nextPageToken || '';
            if (matches.length > 1) throw Error('Multiple history files found; manual recovery required');
        } while (pageToken);
        return matches.length ? matches[0] : null;
    }
    async function load() {
        const entry = await find();
        if (!entry) return { state: 'uninitialized' };
        if (!entry.id) throw Error('History file missing Drive ID');
        const response = await request(API + '/' + encode(entry.id) + '?alt=media');
        const data = await response.json();
        if (!data || data.version !== 1 || !data.calendarId || !data.entries ||
            Array.isArray(data.entries) || typeof data.entries !== 'object') {
            throw Error('Corrupt Drive history; refusing to replace it');
        }
        return { state: 'loaded', fileId: entry.id, history: data };
    }
    async function createOnce(history) {
        if (!history || history.version !== 1 || !history.calendarId || !history.entries) {
            throw Error('Invalid history initialization');
        }
        if (await find()) throw Error('History already exists; never overwrite on initialization');
        const boundary = 'calendarbridge_' + 'history_v1_boundary';
        const meta = JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'],
            mimeType: 'application/json' });
        const body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
            meta + '\r\n--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
            JSON.stringify(history) + '\r\n--' + boundary + '--';
        const response = await request(UPLOAD + '?uploadType=multipart&fields=id,name', {
            method: 'POST',
            headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
            body
        });
        const result = await response.json();
        if (!result.id) throw Error('Drive did not confirm history file creation');
        return result.id;
    }
    // No update API yet. Overwriting durable exclusions requires backups,
    // concurrency controls, and live tests before enabling it.
    return { find, load, createOnce };
}
const api = { FILE_NAME, makeStore };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.CalendarBridgeDriveHistory = api;
})(typeof window !== 'undefined' ? window : globalThis);
