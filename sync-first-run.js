// First-run setup for a NEW, EMPTY dedicated Google calendar.
// Isolated/mocked only; never referenced by Chrome UI or background.
// Never clears an existing calendar or reconstructs historical deletions.
(function(root){
'use strict';
function makeInitializer({store,journal,backupTool,backupVerifier,accountId,calendarId,deviceId}) {
    if(!store||!journal||!backupTool||!backupVerifier||!accountId||
        !calendarId||calendarId==='primary'||!deviceId)throw Error('Invalid initial migration destination');
    async function initialize({backup,approved,liveCalendar,liveEvents}) {
        if(approved!==true||!liveCalendar||liveCalendar.id!==calendarId||
            !['owner','writer'].includes(liveCalendar.accessRole)||
            !Array.isArray(liveEvents))throw Error('First migration needs explicit calendar approval and live scan');
        // All events must be absent from the target. Otherwise adoption and
        // deletion history must be handled separately, not guessed.
        if(liveEvents.length!==0)throw Error('Target calendar is not empty; do not initialize');
        const verified=await backupVerifier.verifySelection(backup,calendarId,backupTool);
        if(verified.eventCount!==0)throw Error('Backup shows existing events; do not initialize');
        if(verified.calendarName!==liveCalendar.summary||
            backup.calendar.accessRole!==liveCalendar.accessRole)
            throw Error('Calendar details changed since backup');
        const state=await store.read(accountId,calendarId);
        if(state?.state!=='uninitialized'||state.head!==null)
            throw Error('Existing synchronization history must never be replaced');
        const history={version:1,accountId,calendarId,writerDeviceId:deviceId,entries:{}};
        journal.validHistory(history);
        const receipt=await store.append(null,history,accountId,calendarId);
        const confirmed=await store.read(accountId,calendarId);
        if(!receipt?.fileId||confirmed.state!=='loaded'||
            confirmed.head?.fileId!==receipt.fileId||
            confirmed.history?.accountId!==accountId||
            confirmed.history?.calendarId!==calendarId||
            confirmed.history?.writerDeviceId!==deviceId||
            Object.keys(confirmed.history.entries||{}).length!==0)
            throw Error('First-run history verification failed');
        return {state:'initialized-empty-destination',historyFileId:receipt.fileId,
            calendarId,calendarName:verified.calendarName};
    }
    return {initialize};
}
const api={makeInitializer};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.CalendarBridgeFirstRun=api;
})(typeof window!=='undefined'?window:globalThis);
