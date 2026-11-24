// Browser-local exclusive run lock (Web Locks API).
// Cross-device protection additionally requires writerDeviceId stored in
// history. If Web Locks is unavailable, fail rather than run unlocked.
(function(root){
'use strict';
function makeLock(locks) {
    if(!locks||typeof locks.request!=='function')
        throw Error('Browser Web Locks unavailable; sync disabled');
    async function runExclusive(accountId,calendarId,fn) {
        if(!accountId||!calendarId||calendarId==='primary'||typeof fn!=='function')
            throw Error('Invalid calendar sync lock request');
        const key='calendar-bridge-sync:'+accountId+':'+calendarId;
        return locks.request(key,{mode:'exclusive'},fn);
    }
    return {runExclusive};
}
const api={makeLock};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.CalendarBridgeBrowserLock=api;
})(typeof window!=='undefined'?window:globalThis);
