// Calendar Bridge synchronization planner — deliberately PURE: NO API calls or writes.
// A plan is advice, not permission to execute. Versioned history must be backed up
// and validated before any future writer is allowed to apply it.
(function (root) {
'use strict';
const VERSION = 1;
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const clean = s => String(s || '').trim().replace(/\s+/g, ' ');
const normalized = s => clean(s).toLowerCase();
function stamp(e) { return [normalized(e.summary), e.start, e.end].join('|'); }
function googleTime(x) {
    if (!x) return null;
    if (typeof x.date === 'string') return x.date;
    if (typeof x.dateTime !== 'string') return null;
    const n = Date.parse(x.dateTime);
    return Number.isFinite(n) ? new Date(n).toISOString() : null;
}
function viewGoogle(g) {
    return { id: g.id || null, uid: g.iCalUID || null,
        summary: g.summary || '', location: g.location || '',
        start: googleTime(g.start), end: googleTime(g.end),
        status: g.status || 'confirmed',
        recurrenceId: g.recurringEventId || null };
}
function emptyHistory(calendarId) {
    if (!calendarId || typeof calendarId !== 'string') throw Error('Calendar ID required');
    return { version: VERSION, calendarId, entries: {} };
}
function validateHistory(history, calendarId) {
    if (!history || history.version !== VERSION ||
        typeof history.entries !== 'object' || history.entries === null ||
        Array.isArray(history.entries) || history.calendarId !== calendarId) {
        throw Error('Missing, corrupt, or wrong-calendar sync history; refusing to plan writes');
    }
    for (const [uid, entry] of Object.entries(history.entries)) {
        if (!uid || !entry || !['active', 'excluded', 'pending'].includes(entry.state) ||
            (entry.state === 'pending' && (!entry.googleId || !entry.requested ||
                !entry.requested.start || !entry.requested.end || !entry.requested.summary)) ||
            (entry.state === 'active' && (!entry.googleId || !entry.lastSynced))) {
            throw Error('Invalid history entry; refusing to plan writes');
        }
    }
}
function plan(outlook, googleEvents, history, opts) {
    const calendarId = opts && opts.calendarId;
    validateHistory(history, calendarId);
    if (!opts || opts.completeOutlook !== true || opts.completeGoogle !== true) {
        throw Error('Both Outlook and Google scans must be complete');
    }
    if (!Array.isArray(outlook) || !Array.isArray(googleEvents)) throw Error('Invalid event input');
    const byUid = new Map(), bySignature = new Map(), byId = new Map(), counts = new Map(), sourceSignatures = new Map();
    const google = googleEvents.filter(g => g.status !== 'cancelled').map(viewGoogle);
    for (const g of google) {
        if (!g.id || !g.start || !g.end) throw Error('Incomplete Google event data');
        if (byId.has(g.id)) throw Error('Repeated Google event ID');
        byId.set(g.id, g);
        if (g.uid) {
            if (!byUid.has(g.uid)) byUid.set(g.uid, []);
            byUid.get(g.uid).push(g);
        }
        const key = stamp(g);
        if (!bySignature.has(key)) bySignature.set(key, []);
        bySignature.get(key).push(g);
    }
    for (const e of outlook) {
        if (!e.uid || !e.start || !e.end || !clean(e.summary)) throw Error('Incomplete Outlook event, including title');
        counts.set(e.uid, (counts.get(e.uid) || 0) + 1);
        sourceSignatures.set(stamp(e), (sourceSignatures.get(stamp(e)) || 0) + 1);
    }
    const actions = { add: [], adopt: [], verifyMissing: [], excluded: [], unchanged: [],
        updateCandidate: [], conflict: [], ambiguous: [] };
    const claimed = new Set();
    for (const e of outlook) {
        if (counts.get(e.uid) !== 1) {
            actions.ambiguous.push({ uid: e.uid, reason: 'Repeated Outlook identity' });
            continue;
        }
        const prior = history.entries[e.uid];
        if (prior && prior.state === 'pending') {
            actions.verifyMissing.push({ uid: e.uid, googleId: prior.googleId,
                reason: 'Pending creation must be reconciled by ID before any retry' });
            continue;
        }
        if (prior && prior.state === 'excluded') {
            actions.excluded.push({ uid: e.uid });
            continue;
        }
        if (prior) {
            const g = byId.get(prior.googleId);
            if (!g) {
                // Could be deleted, moved outside scan range or permission issue.
                // Only a separate GET by ID returning 404/410 can confirm deletion.
                actions.verifyMissing.push({ uid: e.uid, googleId: prior.googleId });
                continue;
            }
            if (claimed.has(g.id)) {
                actions.ambiguous.push({ uid: e.uid, reason: 'Google event already claimed' });
                continue;
            }
            claimed.add(g.id);
            const baseline = prior.lastSynced;
            if (!baseline || !baseline.start || !baseline.end) {
                actions.conflict.push({ uid: e.uid, reason: 'Missing last-synced fields' });
                continue;
            }
            // Never overwrite a Google-side change. No assumption that every
            // title change is a manual fix; mark it as a conflict to preserve it.
            const manual = ['summary','location','start','end'].some(k =>
                (k === 'summary' || k === 'location'
                    ? normalized(g[k]) !== normalized(baseline[k])
                    : g[k] !== baseline[k]));
            const sourceChanged = ['summary','location','start','end'].some(k =>
                (k === 'summary' || k === 'location'
                    ? normalized(e[k]) !== normalized(baseline[k])
                    : e[k] !== baseline[k]));
            if (manual) actions.conflict.push({ uid: e.uid, googleId: g.id,
                reason: 'Google-side edit detected; preserve manual changes' });
            else if (sourceChanged) actions.updateCandidate.push({ uid: e.uid, googleId: g.id });
            else actions.unchanged.push({ uid: e.uid, googleId: g.id });
            continue;
        }
        // First-run adoption is only possible for a UNIQUE exact UID, or a
        // UNIQUE title/time signature. This is a proposal, never a write.
        const uidMatches = byUid.get(e.uid) || [];
        const signatureMatches = bySignature.get(stamp(e)) || [];
        // Do not adopt by title/time if two Outlook items have that same signature.
        if (!uidMatches.length && sourceSignatures.get(stamp(e)) > 1) {
            actions.ambiguous.push({ uid: e.uid, reason: 'Multiple Outlook events share this title and time' });
            continue;
        }
        let matches = uidMatches.length ? uidMatches : signatureMatches;
        // Multiple otherwise identical Outlook items cannot map to same Google ID.
        if (matches.length > 1 || (matches.length === 1 && claimed.has(matches[0].id))) {
            actions.ambiguous.push({ uid: e.uid, reason: 'Multiple or already-claimed Google matches' });
        } else if (matches.length === 1) {
            const g = matches[0];
            claimed.add(g.id);
            actions.adopt.push({ uid: e.uid, googleId: g.id,
                match: uidMatches.length ? 'uid' : 'unique-title-and-time',
                titleDiffers: normalized(e.summary) !== normalized(g.summary) });
        } else {
            // An unknown absence is not proof of a deliberately excluded event.
            actions.add.push({ uid: e.uid });
        }
    }
    return { calendarId, actions, counts: Object.fromEntries(Object.entries(actions).map(
        ([key, items]) => [key, items.length])) };
}
function confirmDeletion(history, uid, googleId, getOutcome) {
    validateHistory(history, history?.calendarId);
    const entry = history.entries[uid];
    if (!entry || entry.state !== 'active' || entry.googleId !== googleId) {
        throw Error('Cannot exclude an unknown or differently mapped event');
    }
    // A lone 404 can also mean revoked calendar access or a wrong account.
    // Prefer an explicit cancelled resource; otherwise require two independent
    // 404/410 event checks *and* a successful calendar access probe.
    const cancelled = getOutcome && getOutcome.eventStatus === 'cancelled';
    const missingConfirmed = getOutcome && [404, 410].includes(getOutcome.firstStatus) &&
        [404, 410].includes(getOutcome.secondStatus) &&
        getOutcome.calendarAccessible === true;
    if (!cancelled && !missingConfirmed) {
        throw Error('Deletion not verified; require cancelled event or repeat missing checks with calendar access');
    }
    return { ...history, entries: { ...history.entries,
        [uid]: { ...entry, state: 'excluded', excludedReason: 'verified-google-deletion' } } };
}
function recordAdoption(history, uid, googleId, fields) {
    validateHistory(history, history?.calendarId);
    if (!uid || !googleId || !fields || !fields.start || !fields.end || !clean(fields.summary)) {
        throw Error('Cannot record incomplete adoption');
    }
    if (own(history.entries, uid)) throw Error('Cannot overwrite existing history');
    if (Object.values(history.entries).some(e => e.googleId === googleId)) {
        throw Error('Google event already mapped');
    }
    return { ...history, entries: { ...history.entries,
        [uid]: { state: 'active', googleId, lastSynced: {
            summary: fields.summary, location: fields.location || '',
            start: fields.start, end: fields.end
        } } } };
}
const api = { emptyHistory, validateHistory, plan, recordAdoption, confirmDeletion };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.CalendarBridgeSync = api;
})(typeof window !== 'undefined' ? window : globalThis);
