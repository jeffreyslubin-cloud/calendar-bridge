// Pure safety gate for a future dedicated work-calendar first sync.
// A real UI must gather the user's approval; a separate verified backup
// workflow must issue the receipt. This module creates neither.
(function(root){
'use strict';
function assertAuthorized(permit, accountId, calendarId) {
    if(!accountId||!calendarId||calendarId==='primary'||!permit ||
        permit.schema!==1||permit.userApproved!==true||
        permit.accountId!==accountId||permit.calendarId!==calendarId||
        permit.calendarName?.trim()?.length<1 ||
        permit.destination?.accessRole!=='owner' &&
        permit.destination?.accessRole!=='writer') {
        throw Error('Dedicated destination authorization missing or mismatched');
    }
    const backup=permit.backup;
    if(!backup||backup.verified!==true||backup.accountId!==accountId||
        backup.calendarId!==calendarId||typeof backup.backupId!=='string'||
        !backup.backupId.trim()||typeof backup.checksum!=='string'||
        !/^[a-f0-9]{64}$/.test(backup.checksum)||
        !Number.isSafeInteger(backup.eventCount)||backup.eventCount<0) {
        throw Error('Verified destination calendar backup required');
    }
    if(permit.destination.id!==calendarId||
        typeof permit.destination.summary!=='string'||
        permit.destination.summary!==permit.calendarName) {
        throw Error('Selected Google calendar identity has changed');
    }
    if(permit.scan?.completeOutlook!==true||permit.scan?.completeGoogle!==true||
        !Number.isSafeInteger(permit.scan.outlookCount)||
        !Number.isSafeInteger(permit.scan.googleCount)||
        permit.scan.outlookCount<0||permit.scan.googleCount<0) {
        throw Error('Verified full-scan receipt required');
    }
    return true;
}
const api={assertAuthorized};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.CalendarBridgeWriteGate=api;
})(typeof window!=='undefined'?window:globalThis);
