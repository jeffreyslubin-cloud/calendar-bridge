// Verifies a previously downloaded backup before first-run authorization.
// This module cannot authorize a sync on its own and has no API writes.
(function(root){
'use strict';
async function verifySelection(backup,selectedCalendarId,backupTool) {
    if(!selectedCalendarId||selectedCalendarId==='primary')
        throw Error('Select a dedicated non-primary destination calendar');
    if(!backupTool||typeof backupTool.verify!=='function')
        throw Error('Backup verifier missing');
    await backupTool.verify(backup);
    if(backup.calendar.id!==selectedCalendarId)
        throw Error('Backup is for a different destination calendar');
    if(!['owner','writer'].includes(backup.calendar.accessRole))
        throw Error('Backup calendar is not writable');
    if(!backup.calendar.summary?.trim())
        throw Error('Calendar name missing from backup');
    if(backup.events.length!==new Set(backup.events.map(e=>e.id)).size)
        throw Error('Backup has duplicate event IDs');
    return {
        calendarId:backup.calendar.id,
        calendarName:backup.calendar.summary,
        eventCount:backup.events.length,
        checksum:backup.checksum.value,
        state:'backup-verified-for-selection'
    };
}
const api={verifySelection};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.CalendarBridgeBackupVerify=api;
})(typeof window!=='undefined'?window:globalThis);
