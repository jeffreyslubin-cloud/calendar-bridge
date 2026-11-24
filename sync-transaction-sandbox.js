// Mockable single-appointment sync transaction. NOT loaded by extension UI.
// A pending history entry is committed BEFORE the first Calendar POST.
// After any uncertain outcome, the entry stays pending and restart uses GET
// only. This is not yet safe for live multi-device operation.
(function(root) {
'use strict';
function makeTransaction({store,planner,journal,safety,recovery,intent,reader,writer,
    accountId,calendarId,subtle}) {
    if(!store||!planner||!journal||!safety||!recovery||!intent||
        !reader||!writer||!accountId||!calendarId||calendarId==='primary'||!subtle)
        throw Error('Incomplete transaction dependencies');
    let busy=false;
    async function withLock(fn) {
        if(busy)throw Error('Sync already in progress in this process');
        busy=true;
        try {return await fn();} finally {busy=false;}
    }
    async function load() {
        const state=await store.read(accountId,calendarId);
        if(state?.state!=='loaded'||!state.head?.fileId||!state.history)
            throw Error('No initialized sync history');
        journal.validHistory(state.history);
        planner.validateHistory(state.history,calendarId);
        if(state.history.accountId!==accountId)throw Error('Wrong account');
        return state;
    }
    async function append(oldState,updated) {
        const saved=await store.append(oldState.head.fileId,updated,accountId,calendarId);
        const confirmed=await load();
        if(!saved?.fileId||confirmed.head.fileId!==saved.fileId)
            throw Error('History append not durably verified');
        return confirmed;
    }
    async function inspectById(id,source) {
        const result=await reader.getById(id);
        if(result?.state==='not-found-unconfirmed')return result;
        if(result?.state!=='found')throw Error('Unknown event read outcome');
        return recovery.inspectRecoveredEvent(id,source,result.event);
    }
    async function finalize(loaded,source,id,verified) {
        const updated=intent.complete(loaded.history,source.uid,id,verified,journal.validHistory);
        const confirmed=await append(loaded,updated);
        if(confirmed.history.entries[source.uid]?.state!=='active'||
            confirmed.history.entries[source.uid]?.googleId!==id)
            throw Error('Finalized mapping not durably verified');
        return {state:'created-and-mapped',headId:confirmed.head.fileId};
    }
    async function create(source,googleEvents,scan) {
        return withLock(async()=>{
            if(scan?.completeOutlook!==true||scan?.completeGoogle!==true||
                !Array.isArray(googleEvents))throw Error('Incomplete calendar scans');
            let loaded=await load();
            const plan=planner.plan([source],googleEvents,loaded.history,{
                calendarId,completeOutlook:true,completeGoogle:true
            });
            if(plan.counts.add!==1||Object.values(plan.counts).some((n,i)=>
                n!==0&&i!==0))throw Error('Planner refused appointment creation');
            const proposed=await safety.prepareAdd(source,loaded.history,{
                accountId,calendarId,completeOutlook:true,completeGoogle:true,
                expectedHistoryFileId:loaded.head.fileId,plan,googleEvents,subtle
            });
            if(proposed.state!=='candidate-only')
                throw Error('Pre-existing event requires reconciliation');
            // Durable create-intent barrier. Any failure from here onward
            // leaves the UID pending, never treated as a new addition.
            const pending=intent.begin(loaded.history,source.uid,proposed.id,source,
                journal.validHistory);
            loaded=await append(loaded,pending);
            if(loaded.history.entries[source.uid]?.state!=='pending')
                throw Error('Create intent not durably stored');
            // GET *after* persisting intent. Existing valid event may have
            // been created by a prior interrupted session.
            const before=await inspectById(proposed.id,source);
            if(before.state==='safe-to-record-existing')
                return finalize(loaded,source,proposed.id,before);
            if(before.state!=='not-found-unconfirmed')
                return {state:'pending-review',reason:before.reason||'unsafe-existing-event'};
            // There is exactly one POST attempt. Never retry it automatically.
            const sent=await writer.insertOnce(proposed.event);
            let after;
            try {after=await inspectById(proposed.id,source);} catch(e) {
                return {state:'pending-review',reason:'read-after-insert-failed'};
            }
            if(after.state==='safe-to-record-existing')
                return finalize(loaded,source,proposed.id,after);
            return {state:'pending-review',reason:after.reason||sent.reason||'unconfirmed-outcome'};
        });
    }
    async function resumePending(uid) {
        return withLock(async()=>{
            const loaded=await load();
            const entry=loaded.history.entries[uid];
            if(!entry||entry.state!=='pending')throw Error('No pending creation to recover');
            const expectedId=await safety.eventId(accountId,calendarId,uid,subtle);
            if(entry.googleId!==expectedId)throw Error('Pending event identity mismatch');
            const source={uid,...entry.requested};
            const result=await inspectById(expectedId,source);
            if(result.state==='safe-to-record-existing')
                return finalize(loaded,source,expectedId,result);
            return {state:'pending-review',reason:result.reason||'event-not-confirmed'};
            // Deliberately NO POST on resume. A user may have deleted
            // the event after creation but before durable history commit.
        });
    }
    return {create,resumePending};
}
const api={makeTransaction};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.CalendarBridgeTransactionSandbox=api;
})(typeof window!=='undefined'?window:globalThis);
