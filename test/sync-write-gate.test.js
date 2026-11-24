const assert=require('assert');
const Gate=require('../sync-write-gate.js');
const valid={schema:1,userApproved:true,accountId:'acct',calendarId:'work',
    calendarName:'My Work Calendar',
    destination:{id:'work',summary:'My Work Calendar',accessRole:'writer'},
    backup:{verified:true,accountId:'acct',calendarId:'work',
        backupId:'verified-backup-1',checksum:'a'.repeat(64),eventCount:2},
    scan:{completeOutlook:true,completeGoogle:true,outlookCount:1,googleCount:2}};
assert.strictEqual(Gate.assertAuthorized(valid,'acct','work'),true);
for(const bad of [
    {...valid,userApproved:false},
    {...valid,calendarId:'primary'},
    {...valid,accountId:'another'},
    {...valid,calendarName:'Different'},
    {...valid,destination:{...valid.destination,accessRole:'reader'}},
    {...valid,backup:{...valid.backup,verified:false}},
    {...valid,backup:{...valid.backup,checksum:'bad'}},
    {...valid,backup:{...valid.backup,calendarId:'primary'}},
    {...valid,scan:{...valid.scan,completeOutlook:false}},
    {...valid,scan:{...valid.scan,googleCount:-1}}
])assert.throws(()=>Gate.assertAuthorized(bad,'acct','work'));
assert.throws(()=>Gate.assertAuthorized(valid,'acct','primary'));
assert.throws(()=>Gate.assertAuthorized(valid,'other','work'));
console.log('✓ verified backup, explicit approval and matching calendar required');
console.log('✓ wrong account, reader role, incomplete scans and primary calendar rejected');
console.log('All write gate tests passed.');
