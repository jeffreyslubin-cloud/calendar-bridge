const assert=require('assert');
const Journal=require('../history-journal.js');
const First=require('../sync-first-run.js');
const sample={format:'calendar-bridge-backup',version:1,calendar:{
    id:'work',summary:'Work Schedule',accessRole:'owner'},events:[],
    checksum:{algorithm:'SHA-256',value:'a'.repeat(64)}};
const backupTool={verify:async()=>true};
const backupVerifier={verifySelection:async(backup,id,tool)=>{
    assert.strictEqual(backup,sample);
    assert.strictEqual(id,'work');
    assert.strictEqual(tool,backupTool);
    return {calendarId:'work',calendarName:'Work Schedule',eventCount:backup.events.length};
}};
const calendar={id:'work',summary:'Work Schedule',accessRole:'owner'};
let head=null,history=null,writes=0;
const store={read:async()=>head===null?{state:'uninitialized',head:null}:{
    state:'loaded',head:{fileId:head},history
},append:async(expected,next)=>{
    assert.strictEqual(expected,head);
    head='root-history-file';history=next;writes++;return {fileId:head};
}};
const initial=First.makeInitializer({store,journal:Journal,backupTool,
    backupVerifier,accountId:'acct',calendarId:'work',deviceId:'device-A'});
(async()=>{
    await assert.rejects(initial.initialize({backup:sample,approved:false,
        liveCalendar:calendar,liveEvents:[]}),/approval/);
    await assert.rejects(initial.initialize({backup:sample,approved:true,
        liveCalendar:calendar,liveEvents:[{id:'existing'}]}),/not empty/);
    assert.strictEqual(writes,0);
    const success=await initial.initialize({backup:sample,approved:true,
        liveCalendar:calendar,liveEvents:[]});
    assert.strictEqual(success.state,'initialized-empty-destination');
    assert.strictEqual(writes,1);
    assert.strictEqual(history.accountId,'acct');
    assert.strictEqual(history.writerDeviceId,'device-A');
    await assert.rejects(initial.initialize({backup:sample,approved:true,
        liveCalendar:calendar,liveEvents:[]}),/Existing synchronization history/);
    assert.strictEqual(writes,1);
    console.log('✓ first-run empty destination initialized exactly once');
    console.log('✓ approval, existing appointments and initialized history block setup');

    const backupWithEvents={...sample,events:[{id:'existing'}]};
    const alternative=First.makeInitializer({store:{...store,read:async()=>({
        state:'uninitialized',head:null})},journal:Journal,
        backupTool,backupVerifier:{verifySelection:async()=>({
            calendarName:'Work Schedule',eventCount:1})},
        accountId:'acct',calendarId:'work',deviceId:'device-A'});
    await assert.rejects(alternative.initialize({backup:backupWithEvents,
        approved:true,liveCalendar:calendar,liveEvents:[]}),/Backup shows existing/);
    assert.throws(()=>First.makeInitializer({store,journal:Journal,
        backupTool,backupVerifier,accountId:'acct',calendarId:'primary',deviceId:'device-A'}),/Invalid/);
    console.log('✓ prior backed-up appointments and primary calendar never overwritten');
    console.log('All first-run migration tests passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
