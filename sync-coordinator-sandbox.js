// Offline-only synchronization coordinator. No calendar mutation methods.
// It takes a mocked/read-only getById adapter and an injected history store.
// Never initializes missing history or treats 404 as permission to create.
(function(root) {
'use strict';
function makeCoordinator({planner, journal, safety, recovery, store, getById,
    accountId, calendarId, subtle}) {
    if (!planner || !journal || !safety || !recovery || !store ||
        typeof getById !== 'function' || !accountId || !calendarId ||
        calendarId === 'primary' || !subtle) {
        throw Error('Missing safe coordinator dependencies');
    }
    async function load() {
        const state = await store.read(accountId,calendarId);
        if (state?.state !== 'loaded' || !state.head?.fileId || !state.history) {
            throw Error('Missing initialized synchronization history; stop');
        }
        journal.validHistory(state.history);
        planner.validateHistory(state.history,calendarId);
        if (state.history.accountId !== accountId) throw Error('Wrong Google account');
        return state;
    }
    async function inspect(outlook, googleEvents, scan) {
        if (scan?.completeOutlook !== true || scan?.completeGoogle !== true ||
            !Array.isArray(outlook) || !Array.isArray(googleEvents)) {
            throw Error('Incomplete source or destination scan');
        }
        const state = await load();
        const plan = planner.plan(outlook,googleEvents,state.history,
            {calendarId,completeOutlook:true,completeGoogle:true});
        const candidates=[],recovered=[],blocked=[];
        // No history mutations occur until all candidates are examined.
        for (const action of plan.actions.add) {
            const source = outlook.find(e=>e.uid===action.uid);
            const candidate = await safety.prepareAdd(source,state.history,{
                accountId,calendarId,completeOutlook:true,completeGoogle:true,
                expectedHistoryFileId:state.head.fileId,plan,googleEvents,subtle
            });
            // No unconditional blind POST, even if absent from the list.
            const observed = await getById(candidate.id,source);
            if (observed?.state === 'not-found-unconfirmed') {
                candidates.push({uid:source.uid,id:candidate.id,
                    state:'needs-explicit-create-authorization'});
            } else if (observed?.state === 'found') {
                const checked = recovery.inspectRecoveredEvent(candidate.id,source,observed.event);
                if (checked.state === 'safe-to-record-existing') {
                    recovered.push({uid:source.uid,id:candidate.id,fields:checked.fields});
                } else {
                    blocked.push({uid:source.uid,reason:checked.reason});
                }
            } else {
                throw Error('Unexpected authoritative event lookup; stop');
            }
        }
        const otherBlockers = [
            ...plan.actions.ambiguous.map(x=>({uid:x.uid,reason:x.reason})),
            ...plan.actions.conflict.map(x=>({uid:x.uid,reason:x.reason})),
            ...plan.actions.verifyMissing.map(x=>({uid:x.uid,reason:'Previously mapped event absent; verify deletion separately'})),
            ...plan.actions.updateCandidate.map(x=>({uid:x.uid,reason:'Source update requires separate authorization'})),
            ...plan.actions.adopt.map(x=>({uid:x.uid,reason:'Prior event adoption requires separate confirmation'}))
        ];
        return {headId:state.head.fileId,plan,candidates,recovered,
            blocked:[...blocked,...otherBlockers]};
    }
    async function commitRecovered(inspection) {
        if (!inspection || !inspection.headId || !Array.isArray(inspection.recovered) ||
            !Array.isArray(inspection.blocked) || !Array.isArray(inspection.candidates) ||
            inspection.blocked.length || inspection.candidates.length) {
            throw Error('Recovery commit blocked by unresolved operations');
        }
        // Re-read BEFORE changing history, so cached inspection cannot be used
        // after another writer advanced the head.
        const state = await load();
        if (state.head.fileId !== inspection.headId) {
            throw Error('History changed since inspection; restart');
        }
        if (!inspection.recovered.length) return {state:'nothing-to-recover'};
        // Recheck each recovered event ID immediately before recording.
        let updated=state.history;
        for(const item of inspection.recovered) {
            const source={uid:item.uid,...item.fields};
            const expected=await safety.eventId(accountId,calendarId,item.uid,subtle);
            if (expected !== item.id) throw Error('Recovery identity changed');
            const observed=await getById(item.id,source);
            if (observed?.state !== 'found') throw Error('Recovered event disappeared');
            const verified=recovery.inspectRecoveredEvent(item.id,source,observed.event);
            if (verified.state !== 'safe-to-record-existing' ||
                JSON.stringify(verified.fields) !== JSON.stringify(item.fields)) {
                throw Error('Recovered event changed since inspection');
            }
            updated=planner.recordAdoption(updated,item.uid,item.id,item.fields);
        }
        journal.validHistory(updated);
        // Store is append-only and refuses stale heads. Caller must separately
        // enforce a single active sync, and never make Calendar writes here.
        const receipt=await store.append(state.head.fileId,updated,accountId,calendarId);
        const confirmed=await load();
        if (receipt?.fileId !== confirmed.head.fileId) {
            throw Error('History persistence verification failed');
        }
        for(const item of inspection.recovered) {
            if(confirmed.history.entries[item.uid]?.googleId !== item.id) {
                throw Error('Recovered appointment mapping not durably stored');
            }
        }
        return {state:'recovered',count:inspection.recovered.length,headId:receipt.fileId};
    }
    return {inspect,commitRecovered};
}
const api={makeCoordinator};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.CalendarBridgeSyncCoordinator=api;
})(typeof window!=='undefined'?window:globalThis);
