// Pure two-stage history transaction for safe appointment creation.
// Stage pending MUST be persisted before an event insert; missing on restart
// NEVER implies permission to POST again. Finalize only after GET-by-ID verifies.
(function(root) {
'use strict';
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const normalize=x=>String(x||'').trim().replace(/\s+/g,' ').toLowerCase();
function fieldsOf(source) {
    if(!source||typeof source.summary!=='string'||!source.summary.trim()||
        typeof source.start!=='string'||typeof source.end!=='string'||
        !Number.isFinite(Date.parse(source.start))||
        !Number.isFinite(Date.parse(source.end))||
        Date.parse(source.end)<=Date.parse(source.start)) {
        throw Error('Incomplete pending creation fields');
    }
    return {summary:source.summary,location:source.location||'',
        start:source.start,end:source.end};
}
function begin(history,uid,googleId,source,validator) {
    validator(history);
    if(!uid||!googleId||own(history.entries,uid)||
        Object.values(history.entries).some(e=>e.googleId===googleId)) {
        throw Error('Creation identity already recorded or invalid');
    }
    const requested=fieldsOf(source);
    return {...history,entries:{...history.entries,[uid]:{
        state:'pending',googleId,requested
    }}};
}
function complete(history,uid,googleId,verified,validator) {
    validator(history);
    const prior=history.entries[uid];
    if(!prior||prior.state!=='pending'||prior.googleId!==googleId||
        !verified||verified.state!=='safe-to-record-existing'||verified.id!==googleId||
        !verified.fields) throw Error('Pending creation cannot be finalized');
    const expected=prior.requested,fields=verified.fields;
    if(['summary','location','start','end'].some(k=>
        k==='summary'||k==='location'?
            normalize(expected[k])!==normalize(fields[k]):
            expected[k]!==fields[k])) {
        throw Error('Verified Google event differs from original creation intent');
    }
    return {...history,entries:{...history.entries,[uid]:{
        state:'active',googleId,lastSynced:fields
    }}};
}
const api={begin,complete,fieldsOf};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.CalendarBridgeCreateIntent=api;
})(typeof window!=='undefined'?window:globalThis);
