// Local-only integrity check of an already downloaded Google Calendar backup.
// This does not grant write access or initialize synchronization history.
document.addEventListener('DOMContentLoaded',()=>{
    const input=document.getElementById('googleBackupFile');
    const status=document.getElementById('googleBackupVerifyStatus');
    const calendar=document.getElementById('googleCalendarId');
    if(!input||!status||!calendar)return;
    input.addEventListener('change',async()=>{
        const file=input.files?.[0];
        if(!file)return;
        status.textContent='Checking backup integrity and destination identity…';
        try{
            if(file.size>50*1024*1024)throw Error('Backup too large for popup verification');
            const parsed=JSON.parse(await file.text());
            const backupTool=window.CalendarBridgeBackup.makeBackup(
                async()=>{throw Error('Network access not allowed in local backup check');},
                'local-verification-only');
            const result=await window.CalendarBridgeBackupVerify.verifySelection(
                parsed,calendar.value.trim(),backupTool);
            status.textContent='Verified backup for '+result.calendarName+
                ' ('+result.eventCount+' events). This confirms file integrity, not sync readiness.';
        }catch(e){
            status.textContent='Backup verification failed: '+(e?.message||String(e));
        }finally{input.value='';}
    });
});
