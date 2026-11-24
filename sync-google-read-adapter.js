// Read-only Google Calendar event adapter for the offline sync coordinator.
// Not loaded in the extension. No calendar mutation methods are exposed.
(function(root) {
'use strict';
function makeReader(fetchImpl,token,calendarId) {
    if(typeof fetchImpl!=='function'||!token||!calendarId||
        calendarId==='primary') throw Error('Invalid read-only Calendar reader');
    async function getById(id) {
        if(typeof id!=='string'||!/^cb[0-9a-v]{52}$/.test(id)) {
            throw Error('Unexpected Calendar Bridge event ID');
        }
        const url='https://www.googleapis.com/calendar/v3/calendars/'+
            encodeURIComponent(calendarId)+'/events/'+encodeURIComponent(id);
        const response=await fetchImpl(url,{
            method:'GET',cache:'no-store',
            headers:{Authorization:'Bearer '+token}
        });
        if(!response)throw Error('Google Calendar returned no response');
        if(response.status===404||response.status===410)
            return {state:'not-found-unconfirmed',status:response.status};
        if(!response.ok)throw Error('Google Calendar read failed HTTP '+response.status);
        const data=await response.json();
        if(!data||data.id!==id)throw Error('Google Calendar returned a different event');
        return {state:'found',event:data};
    }
    return {getById};
}
const api={makeReader};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.CalendarBridgeReadAdapter=api;
})(typeof window!=='undefined'?window:globalThis);
