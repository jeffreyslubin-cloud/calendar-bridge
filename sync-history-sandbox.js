// Calendar Bridge history integration sandbox.
// NOT referenced by manifest/popup, and never talks to Google Calendar.
// Uses a caller-supplied Drive journal store so mocked tests can verify
// actual persistence/recovery without touching the user's account.
(function (root) {
'use strict';
function createSandbox(planner, journal, driveStore, accountId, calendarId) {
    if (!planner || !journal || !driveStore ||
        !accountId || !calendarId || calendarId === 'primary') {
        throw new Error('Sandbox requires a non-primary calendar and explicit account identity');
    }
    const options = { calendarId, completeOutlook: true, completeGoogle: true };
    function validate(history) {
        journal.validHistory(history);
        if (history.accountId !== accountId || history.calendarId !== calendarId) {
            throw new Error('History account/calendar mismatch');
        }
        planner.validateHistory(history, calendarId);
    }
    async function load() {
        const state = await driveStore.read(accountId, calendarId);
        if (state.state !== 'loaded' || !state.head || !state.history) {
            throw new Error('No initialized sync history; explicit migration required');
        }
        validate(state.history);
        return state;
    }
    // First-run migration must be separately authorized by a future UI.
    // This sandbox intentionally offers NO initialize or reset method.
    async function preview(outlook, googleEvents) {
        const state = await load();
        const result = planner.plan(outlook, googleEvents, state.history, options);
        return { generation: state.head.data.generation,
            historyFileId: state.head.fileId, result };
    }
    function requireExpectedHead(state, expectedFileId) {
        if (!expectedFileId || state.head.fileId !== expectedFileId) {
            throw new Error('Stale history view; reload before recording decisions');
        }
    }
    async function adoptExisting(expectedFileId, outlookEvent, googleEvent) {
        const state = await load();
        requireExpectedHead(state, expectedFileId);
        const p = planner.plan([outlookEvent], [googleEvent], state.history, options);
        if (p.counts.adopt !== 1 || Object.entries(p.counts).some(([key, count]) =>
            key !== 'adopt' && count !== 0)) {
            throw new Error('Event not uniquely adoptable');
        }
        const adoption = p.actions.adopt[0];
        if (adoption.googleId !== googleEvent.id || !adoption.uid ||
            adoption.titleDiffers) {
            throw new Error('Title mismatch or unsafe calendar identity');
        }
        // Only accept an identical location and time as a baseline. A
        // user-edited Google event must never be silently overwritten.
        const normalize = x => String(x || '').trim().replace(/\s+/g, ' ').toLowerCase();
        const googleFields = {
            summary: googleEvent.summary || '',
            location: googleEvent.location || '',
            start: googleEvent.start?.date || (
                googleEvent.start?.dateTime &&
                new Date(googleEvent.start.dateTime).toISOString()),
            end: googleEvent.end?.date || (
                googleEvent.end?.dateTime &&
                new Date(googleEvent.end.dateTime).toISOString())
        };
        if (normalize(googleFields.summary) !== normalize(outlookEvent.summary) ||
            normalize(googleFields.location) !== normalize(outlookEvent.location) ||
            googleFields.start !== outlookEvent.start ||
            googleFields.end !== outlookEvent.end) {
            throw new Error('Google details differ from Outlook; preserve manual edits');
        }
        const updated = planner.recordAdoption(state.history, adoption.uid,
            adoption.googleId, googleFields);
        validate(updated);
        const saved = await driveStore.append(expectedFileId, updated, accountId, calendarId);
        if (!saved?.fileId) throw new Error('History append was not confirmed');
        const confirmed = await load();
        if (confirmed.head.fileId !== saved.fileId ||
            !confirmed.history.entries[adoption.uid] ||
            confirmed.history.entries[adoption.uid].googleId !== adoption.googleId) {
            throw new Error('History verification after adoption failed');
        }
        return { state: 'adopted', historyFileId: saved.fileId };
    }
    // Receives evidence from a future authoritative Google event GET layer.
    // No access to real Google API is provided here.
    async function recordVerifiedDeletion(expectedFileId, uid, googleId, evidence) {
        const state = await load();
        requireExpectedHead(state, expectedFileId);
        const updated = planner.confirmDeletion(state.history, uid, googleId, evidence);
        validate(updated);
        const saved = await driveStore.append(expectedFileId, updated, accountId, calendarId);
        if (!saved?.fileId) throw new Error('History append was not confirmed');
        const confirmed = await load();
        if (confirmed.head.fileId !== saved.fileId ||
            confirmed.history.entries[uid]?.state !== 'excluded') {
            throw new Error('Deletion exclusion not durably verified');
        }
        return { state: 'excluded', historyFileId: saved.fileId };
    }
    return { preview, adoptExisting, recordVerifiedDeletion };
}
const api = { createSandbox };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.CalendarBridgeHistorySandbox = api;
})(typeof window !== 'undefined' ? window : globalThis);
