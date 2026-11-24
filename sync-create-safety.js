// Prepare deterministic Google Calendar creation identities without making API calls.
// Future writer MUST check existing event ID AND persisted history before POST.
// Google Calendar event IDs: base32hex lowercase (0-9,a-v), length 5..1024.
// No real Google writes are implemented here.
(function(root) {
'use strict';
const textEncoder = new TextEncoder();
const alphabet = '0123456789abcdefghijklmnopqrstuv';
function encodeBase32hex(bytes) {
    let acc = 0, bits = 0, output = '';
    for (const byte of bytes) {
        acc = (acc << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            bits -= 5;
            output += alphabet[(acc >>> bits) & 31];
            acc &= (1 << bits) - 1;
        }
    }
    if (bits) output += alphabet[(acc << (5 - bits)) & 31];
    return output;
}
async function eventId(accountId, calendarId, outlookUid, subtle = globalThis.crypto?.subtle) {
    if (![accountId, calendarId, outlookUid].every(x => typeof x === 'string' && x.trim()) ||
        !subtle || typeof subtle.digest !== 'function') throw Error('Missing identity or hashing support');
    // JSON string encoding gives unambiguous separators, including for UIDs with colons.
    const key = JSON.stringify(['calendar-bridge-v1', accountId, calendarId, outlookUid]);
    const digest = new Uint8Array(await subtle.digest('SHA-256', textEncoder.encode(key)));
    return 'cb' + encodeBase32hex(digest);
}
async function prepareAdd(source, history, options) {
    const {accountId, calendarId, completeOutlook, completeGoogle,
        expectedHistoryFileId, plan, googleEvents, subtle} = options || {};
    if (!accountId || !calendarId || calendarId === 'primary' ||
        completeOutlook !== true || completeGoogle !== true ||
        !expectedHistoryFileId || !plan || !Array.isArray(googleEvents)) {
        throw Error('Unsafe or incomplete event creation context');
    }
    if (!history || history.accountId !== accountId || history.calendarId !== calendarId ||
        history.version !== 1 || !history.entries || Array.isArray(history.entries)) {
        throw Error('Missing or wrong history');
    }
    if (!source || !source.uid || !source.summary || !source.start || !source.end ||
        !Number.isFinite(Date.parse(source.start)) || !Number.isFinite(Date.parse(source.end)) ||
        Date.parse(source.end) <= Date.parse(source.start)) {
        throw Error('Invalid event fields');
    }
    const additions = plan.actions?.add || [];
    if (additions.filter(x=>x.uid===source.uid).length !== 1 ||
        Object.hasOwn(history.entries,source.uid) ||
        (plan.actions?.ambiguous || []).some(x=>x.uid===source.uid) ||
        (plan.actions?.conflict || []).some(x=>x.uid===source.uid)) {
        throw Error('Event is not authorized for addition by planner');
    }
    const id = await eventId(accountId,calendarId,source.uid,subtle);
    const existing = googleEvents.filter(g=>g.id===id);
    if (existing.length) {
        // Retrying after an interrupted POST MUST reconcile identity and content
        // instead of blindly creating or overwriting a calendar event.
        return {state:'reconcile-existing', id, expectedHistoryFileId};
    }
    return {state:'candidate-only', id, expectedHistoryFileId,
        event: {
            id, summary:source.summary,
            location:source.location || '',
            start:{dateTime:source.start},
            end:{dateTime:source.end},
            extendedProperties:{private:{
                calendarBridge:'v1',
                calendarBridgeUid:source.uid
            }}
        }
    };
}
const api = { encodeBase32hex, eventId, prepareAdd };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.CalendarBridgeCreateSafety = api;
})(typeof window !== 'undefined' ? window : globalThis);
