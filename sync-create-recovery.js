// Authoritative read-only recovery check for a possible interrupted
// Google Calendar event create. No POST/PATCH/DELETE paths exist here.
// A missing event does NOT authorize a new create on its own.
(function(root) {
'use strict';
function canonicalTime(x) {
    if (!x || typeof x !== 'object') return null;
    if (typeof x.date === 'string') return x.date;
    if (typeof x.dateTime !== 'string' || !Number.isFinite(Date.parse(x.dateTime))) return null;
    return new Date(x.dateTime).toISOString();
}
function normalize(x) { return String(x || '').trim().replace(/\s+/g,' ').toLowerCase(); }
function inspectRecoveredEvent(expectedId, source, data) {
    if (!expectedId || !source?.uid || !source?.summary || !source?.start || !source?.end) {
        throw Error('Incomplete recovery identity');
    }
    if (!data || data.id !== expectedId) throw Error('Unexpected Google event identity');
    if (data.status === 'cancelled') return {state:'blocked',reason:'Google event is cancelled'};
    if (data.recurringEventId || data.recurrence) return {state:'blocked',reason:'Recurring Google event requires review'};
    const marker = data.extendedProperties?.private;
    if (marker?.calendarBridge !== 'v1' || marker?.calendarBridgeUid !== source.uid) {
        return {state:'blocked',reason:'Existing event does not have matching Calendar Bridge ownership marker'};
    }
    const fields = {
        summary:data.summary || '', location:data.location || '',
        start:canonicalTime(data.start), end:canonicalTime(data.end)
    };
    if (!fields.start || !fields.end || !fields.summary) {
        return {state:'blocked',reason:'Google event has missing fields'};
    }
    if (normalize(fields.summary) !== normalize(source.summary) ||
        normalize(fields.location) !== normalize(source.location) ||
        fields.start !== source.start || fields.end !== source.end) {
        return {state:'blocked',reason:'Google event was changed; preserve Google-side edits'};
    }
    return {state:'safe-to-record-existing', id:expectedId, fields};
}
async function checkById(fetchImpl, token, accountId, calendarId, source, expectedId,
    idFactory) {
    if (typeof fetchImpl !== 'function' || !token || !accountId ||
        !calendarId || calendarId === 'primary' || !source?.uid ||
        typeof idFactory !== 'function') throw Error('Missing recovery authorization');
    const correctId = await idFactory(accountId,calendarId,source.uid);
    if (correctId !== expectedId) throw Error('Recovery identity mismatch');
    const url = 'https://www.googleapis.com/calendar/v3/calendars/' +
        encodeURIComponent(calendarId) + '/events/' + encodeURIComponent(expectedId);
    // GET-by-ID, not a date-window search. This cannot tell whether the
    // calendar is writable or whether future POST will succeed.
    const response = await fetchImpl(url, {
        method:'GET',cache:'no-store',
        headers:{Authorization:'Bearer '+token}
    });
    if (!response) throw Error('Missing Google response');
    if (response.status === 404 || response.status === 410) {
        return {state:'not-found-unconfirmed',status:response.status};
    }
    if (!response.ok) throw Error('Google Calendar recovery check failed HTTP '+response.status);
    return inspectRecoveredEvent(expectedId,source,await response.json());
}
const api={canonicalTime,inspectRecoveredEvent,checkById};
if (typeof module !== 'undefined' && module.exports) module.exports=api;
root.CalendarBridgeCreateRecovery=api;
})(typeof window !== 'undefined' ? window : globalThis);
