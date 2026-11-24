// Pure validation for append-only synchronization history snapshots.
// A snapshot is immutable. Concurrent writers may create forks, but a fork is
// detected and blocks further synchronization instead of silently losing edits.
(function (root) {
'use strict';
const VERSION = 1;
function validHistory(h) {
    if (!h || h.version !== 1 || typeof h.calendarId !== 'string' || !h.calendarId ||
        typeof h.accountId !== 'string' || !h.accountId ||
        !h.entries || typeof h.entries !== 'object' || Array.isArray(h.entries)) {
        throw new Error('Invalid sync history or missing account/calendar identity');
    }
    for (const [uid, value] of Object.entries(h.entries)) {
        if (!uid || !value || !['active', 'excluded', 'pending'].includes(value.state) ||
            (value.state === 'pending' && (!value.googleId || !value.requested ||
                !value.requested.start || !value.requested.end || !value.requested.summary)) ||
            (value.state === 'active' && (!value.googleId || !value.lastSynced))) {
            throw new Error('Invalid sync history entry');
        }
    }
    return h;
}
function snapshot(generation, previousFileId, history, createdAt) {
    validHistory(history);
    if (!Number.isSafeInteger(generation) || generation < 0 ||
        (generation === 0 ? previousFileId !== null :
            typeof previousFileId !== 'string' || !previousFileId) ||
        !Number.isFinite(Date.parse(createdAt))) {
        throw new Error('Invalid snapshot metadata');
    }
    return { journalVersion: VERSION, generation, previousFileId, createdAt,
        history: JSON.parse(JSON.stringify(history)) };
}
function resolve(files, expectedAccountId, expectedCalendarId) {
    if (!Array.isArray(files)) throw new Error('Invalid snapshot list');
    if (!files.length) return { state: 'uninitialized', head: null };
    const byId = new Map(), childCounts = new Map();
    let rootCount = 0;
    for (const record of files) {
        const id = record?.fileId, data = record?.data;
        if (!id || byId.has(id) || !data || data.journalVersion !== VERSION) {
            throw new Error('Corrupt or repeated snapshot');
        }
        const h = validHistory(data.history);
        if (h.accountId !== expectedAccountId || h.calendarId !== expectedCalendarId) {
            throw new Error('Sync history belongs to a different account or calendar');
        }
        if (!Number.isSafeInteger(data.generation) || data.generation < 0 ||
            !Number.isFinite(Date.parse(data.createdAt || ''))) {
            throw new Error('Invalid snapshot sequence');
        }
        if (data.generation === 0 && data.previousFileId === null) rootCount++;
        else if (typeof data.previousFileId !== 'string' || !data.previousFileId) {
            throw new Error('Broken snapshot parent');
        }
        byId.set(id, record);
        if (data.previousFileId) {
            childCounts.set(data.previousFileId, (childCounts.get(data.previousFileId) || 0) + 1);
        }
    }
    if (rootCount !== 1) throw new Error('History must have exactly one root');
    for (const record of files) {
        const d = record.data;
        if (!d.previousFileId) continue;
        const parent = byId.get(d.previousFileId);
        if (!parent || parent.data.generation + 1 !== d.generation) {
            throw new Error('Missing or inconsistent snapshot parent');
        }
        if (childCounts.get(d.previousFileId) !== 1) {
            throw new Error('Concurrent history branches detected; recovery required');
        }
    }
    const heads = files.filter(r => !childCounts.has(r.fileId));
    if (heads.length !== 1 || heads[0].data.generation !== files.length - 1) {
        throw new Error('Disconnected or competing history snapshots');
    }
    return { state: 'loaded', head: heads[0],
        history: JSON.parse(JSON.stringify(heads[0].data.history)), count: files.length };
}
const api = { validHistory, snapshot, resolve };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.CalendarBridgeHistoryJournal = api;
})(typeof window !== 'undefined' ? window : globalThis);
