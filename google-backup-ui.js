// User-initiated Google backup download. No synchronization writes.
// A browser download can be cancelled or relocated, so the UI does NOT
// issue a production backup/authorization receipt.
document.addEventListener('DOMContentLoaded',()=>{
    const button=document.getElementById('googleBackupButton');
    const status=document.getElementById('googleBackupStatus');
    const field=document.getElementById('googleCalendarId');
    if(!button||!status||!field)return;
    button.addEventListener('click',async()=>{
        const calendarId=field.value.trim();
        if(!calendarId){status.textContent='Enter a Google calendar ID first.';return;}
        button.disabled=true;
        try{
            status.textContent='Authorizing read-only calendar backup…';
            const auth=await chrome.identity.getAuthToken({interactive:true});
            const token=typeof auth==='string'?auth:auth?.token;
            if(!token)throw Error('Google did not return a token');
            status.textContent='Reading all events and recurring definitions…';
            const service=window.CalendarBridgeBackup.makeBackup(fetch,token);
            const result=await service.capture(calendarId);
            const json=JSON.stringify(result.backup,null,2);
            // Verify the exact serialized payload we are about to download.
            await service.verify(JSON.parse(json));
            const blob=new Blob([json],{type:'application/json'});
            const url=URL.createObjectURL(blob);
            const anchor=document.createElement('a');
            anchor.href=url;
            anchor.download='calendar-bridge-backup-'+new Date().toISOString().slice(0,10)+'.json';
            document.body.appendChild(anchor);
            try{anchor.click();}finally{
                anchor.remove();
                setTimeout(()=>URL.revokeObjectURL(url),60000);
            }
            status.textContent='Backup prepared: '+result.eventCount+
                ' events from '+result.calendar.summary+
                '. Save the downloaded JSON somewhere safe. No appointments changed.';
        }catch(e){
            status.textContent='Backup failed: '+(e?.message||String(e))+
                '. No sync authorization was granted.';
        }finally{button.disabled=false;}
    });
});
