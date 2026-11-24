// Read-only synchronization readiness summary.
// No event or Drive writes and no automatic first-run initialization.
(function(root){
'use strict';
async function assess({sourceResponse,calendarBackup,historyState,accountId,calendarId,
    parseICS,planner}) {
    if(!sourceResponse||typeof sourceResponse.ics!=='string'||
        typeof parseICS!=='function'||!planner||
        !calendarBackup||!calendarBackup.backup?.calendar||
        !accountId||!calendarId)throw Error('Incomplete readiness inputs');
    const outlook=parseICS(sourceResponse.ics);
    const blockers=[];
    if(calendarId==='primary')blockers.push('Choose a separate work calendar; primary is never a sync destination');
    if(calendarBackup.calendar?.id!==calendarId)
        blockers.push('Google calendar identity is not what was selected');
    if(!['owner','writer'].includes(calendarBackup.calendar?.accessRole))
        blockers.push('Google account cannot edit this calendar');
    if(sourceResponse.skippedCount>0)
        blockers.push(sourceResponse.skippedCount+' Outlook appointments were omitted');
    if(outlook.length===0||outlook.length!==sourceResponse.eventCount)
        blockers.push('Outlook appointment count mismatch');
    if(new Set(outlook.map(x=>x.uid)).size!==outlook.length)
        blockers.push('Outlook contains repeated appointment identities');
    if(calendarBackup.eventCount!==calendarBackup.backup.events.length)
        blockers.push('Google calendar event count mismatch');
    const calendarEvents=calendarBackup.backup.events;
    if(calendarEvents.some(e=>e.recurrence||e.recurringEventId))
        blockers.push('Recurring Google events require separate matching review');
    let preview=null;
    if(historyState?.state==='uninitialized') {
        blockers.push('Sync history not initialized; first-run migration requires approval');
        if(calendarEvents.length)
            blockers.push('Selected Google calendar is not empty; automatic first-run import is unsafe');
    }else if(historyState?.state==='loaded') {
        if(historyState.history?.accountId!==accountId||
            historyState.history?.calendarId!==calendarId)
            blockers.push('History belongs to another account or calendar');
        else if(!blockers.length) {
            const p=planner.plan(outlook,calendarEvents,historyState.history,
                {calendarId,completeOutlook:true,completeGoogle:true});
            preview=p.counts;
            for(const category of ['conflict','ambiguous','verifyMissing','adopt','updateCandidate'])
                if(p.counts[category])blockers.push(category+': '+p.counts[category]+' need resolution');
        }
    }else {
        blockers.push('History could not be verified');
    }
    return {status:'read-only',readyForWrites:false,
        outlookCount:outlook.length,googleCount:calendarEvents.length,
        historyState:historyState?.state||'unknown',
        preview,blockers};
}
const api={assess};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.CalendarBridgeReadiness=api;
})(typeof window!=='undefined'?window:globalThis);
