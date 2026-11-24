// Stable local browser-installation identity for a future single-writer sync.
// Stored in chrome.storage.local, NOT chrome.storage.sync. Losing this identity
// must force an explicit history-owner recovery, never create a new writer.
(function(root){
'use strict';
const KEY='calendarBridgeWriterDeviceIdV1';
const valid=x=>typeof x==='string'&&/^device-[0-9a-f]{32}$/.test(x);
function makeIdentity(storage,uuid,locks) {
    if(!storage||typeof storage.get!=='function'||
        typeof storage.set!=='function'||typeof uuid!=='function'||
        !locks||typeof locks.request!=='function')
        throw Error('Secure browser-local identity storage unavailable');
    async function getOrCreate() {
        return locks.request('calendar-bridge-device-identity',{mode:'exclusive'},async()=>{
            const stored=await storage.get(KEY);
            const old=stored?.[KEY];
            if(old!==undefined) {
                if(!valid(old))throw Error('Invalid installed writer identity; recovery required');
                return old;
            }
            const id='device-'+uuid().replace(/-/g,'').toLowerCase();
            if(!valid(id))throw Error('Secure random device identity unavailable');
            await storage.set({[KEY]:id});
            const confirmed=await storage.get(KEY);
            if(confirmed?.[KEY]!==id)throw Error('Writer identity persistence failed');
            return id;
        });
    }
    return {getOrCreate};
}
const api={KEY,makeIdentity};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.CalendarBridgeDeviceIdentity=api;
})(typeof window!=='undefined'?window:globalThis);
