// Isolated Calendar POST adapter for simulator-only transaction runner.
// This module is NOT loaded in popup/manifest. NEVER retry POST on error,
// timeout, 409, or unknown response; caller must GET and reconcile.
(function(root) {
'use strict';
function makeWriter(fetchImpl, token, calendarId) {
    if(typeof fetchImpl!=='function'||!token||!calendarId||calendarId==='primary')
        throw Error('Invalid calendar create adapter');
    async function insertOnce(event) {
        if(!event||!/^cb[0-9a-v]{52}$/.test(event.id||'')||
            !event.summary||!event.start?.dateTime||!event.end?.dateTime||
            !event.extendedProperties?.private?.calendarBridgeUid||
            event.extendedProperties.private.calendarBridge!=='v1') {
            throw Error('Invalid creation payload');
        }
        const url='https://www.googleapis.com/calendar/v3/calendars/'+
            encodeURIComponent(calendarId)+'/events?sendUpdates=none';
        // Network rejection leaves ambiguous result: the server might have
        // committed the request. No retries of POST from this module.
        let response;
        try {
            response=await fetchImpl(url,{method:'POST',cache:'no-store',
                headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
                body:JSON.stringify(event)});
        } catch(e) {
            return {state:'unknown-outcome',reason:'network-error'};
        }
        if(!response) return {state:'unknown-outcome',reason:'no-response'};
        if(response.status===409)
            return {state:'unknown-outcome',reason:'conflict-409'};
        if(!response.ok)
            return {state:'unknown-outcome',reason:'http-'+response.status};
        // A successful POST still needs authoritative GET + history commit.
        let data;
        try {data=await response.json();} catch(e) {
            return {state:'unknown-outcome',reason:'unreadable-response'};
        }
        if(data?.id!==event.id)
            return {state:'unknown-outcome',reason:'wrong-returned-id'};
        return {state:'insert-reported-success',id:data.id};
    }
    return {insertOnce};
}
const api={makeWriter};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.CalendarBridgeIsolatedInsert=api;
})(typeof window!=='undefined'?window:globalThis);
