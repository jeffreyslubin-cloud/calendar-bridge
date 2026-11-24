// Single read-only readiness check; never calls Calendar events.insert or
// Drive append. Requires Chrome OAuth and current Outlook browser tab.
document.addEventListener('DOMContentLoaded',()=>{
    const button=document.getElementById('syncReadinessButton');
    const output=document.getElementById('syncReadinessStatus');
    const calendarInput=document.getElementById('googleCalendarId');
    if(!button||!output||!calendarInput)return;
    async function outlookPreview() {
        const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
        if(!tab?.id)throw Error('Open Outlook Calendar before checking readiness');
        const options={
            action:'exportCalendar',destination:'preview',
            timezone:document.getElementById('timezone').value,
            exportDays:Number(document.getElementById('exportDays').value),
            calendarName:document.getElementById('calendarName').value.trim()||null,
            includeDeclined:document.getElementById('includeDeclined').checked,
            includeOOO:document.getElementById('includeOOO').checked
        };
        return new Promise((resolve,reject)=>{
            chrome.tabs.sendMessage(tab.id,options,response=>{
                if(chrome.runtime.lastError||!response?.success||
                    response.delivery!=='preview'||!response.ics)
                    reject(Error(response?.error||'Outlook scan failed'));
                else resolve(response);
            });
        });
    }
    button.addEventListener('click',async()=>{
        const calendarId=calendarInput.value.trim();
        if(!calendarId){output.textContent='Enter a destination calendar ID.';return;}
        button.disabled=true;
        output.textContent='Reading Outlook and Google calendar information…';
        try{
            const auth=await chrome.identity.getAuthToken({interactive:true});
            const token=typeof auth==='string'?auth:auth?.token;
            if(!token)throw Error('Google did not provide a token');
            const primaryResponse=await fetch(
                'https://www.googleapis.com/calendar/v3/users/me/calendarList/primary?fields=id',
                {method:'GET',cache:'no-store',headers:{Authorization:'Bearer '+token}});
            if(!primaryResponse.ok)throw Error('Cannot confirm Google account identity (HTTP '+primaryResponse.status+')');
            const accountId=(await primaryResponse.json()).id;
            if(!accountId)throw Error('Google account identity missing');
            const [sourceResponse,calendarBackup]=await Promise.all([
                outlookPreview(),
                window.CalendarBridgeBackup.makeBackup(fetch,token).capture(calendarId)
            ]);
            // Drive journal is read-only in this button. It does not call append.
            const store=window.CalendarBridgeDriveJournal.makeStore(fetch,token,
                window.CalendarBridgeHistoryJournal,()=>crypto.randomUUID());
            const historyState=await store.read(accountId,calendarId);
            const result=await window.CalendarBridgeReadiness.assess({
                sourceResponse,calendarBackup,historyState,accountId,calendarId,
                parseICS:window.CalendarBridgePreview.parseICS,
                planner:window.CalendarBridgeSync
            });
            output.textContent='Read-only readiness: '+result.outlookCount+
                ' Outlook events, '+result.googleCount+' Google events; '+
                (result.blockers.length?'Not ready — '+result.blockers.join('; '):
                    'No blockers found in this check. Live writes are still disabled.')+
                ' No appointments or history changed.';
        }catch(e){
            output.textContent='Readiness check stopped: '+(e?.message||String(e))+
                '. No changes made.';
        }finally{button.disabled=false;}
    });
});
