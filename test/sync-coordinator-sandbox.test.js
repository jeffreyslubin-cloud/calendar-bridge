// Run in GitHub Actions: node test/sync-coordinator-sandbox.test.js
// No network or Google Calendar mutation. Uses in-memory history and event GETs.
const assert=require('assert');
const {webcrypto}=require('crypto');
const Planner=require('../sync-planner.js');
const Journal=require('../history-journal.js');
const Safety=require('../sync-create-safety.js');
const Recovery=require('../sync-create-recovery.js');
const Coordinator=require('../sync-coordinator-sandbox.js');
const source={uid:'shift-17',summary:'ER Shift',location:'Hershey',
    start:'2026-12-11T21:00:00.000Z',end:'2026-12-12T05:00:00.000Z'};
const initial={version:1,accountId:'acct',calendarId:'work',entries:{}};
let idCounter=0;
let current={state:'loaded',head:{fileId:'head-0'},history:initial};
const store={
    read:async()=>JSON.parse(JSON.stringify(current)),
    append:async(head,history)=>{
        if(head!==current.head.fileId)throw Error('Stale append');
        const fileId='head-'+(++idCounter);
        current={state:'loaded',head:{fileId},history:JSON.parse(JSON.stringify(history))};
        return {fileId};
    }
};
let lookupMode='missing', lookups=0, details=null;
const getById=async(id)=>{
    lookups++;
    if(lookupMode==='denied')throw Error('Google HTTP 403');
    if(lookupMode==='missing')return {state:'not-found-unconfirmed'};
    return {state:'found',event:details||{
        id,summary:source.summary,location:source.location,
        start:{dateTime:source.start},end:{dateTime:source.end},
        extendedProperties:{private:{calendarBridge:'v1',calendarBridgeUid:source.uid}}
    }};
};
const coord=Coordinator.makeCoordinator({
    planner:Planner,journal:Journal,safety:Safety,recovery:Recovery,store,
    getById,accountId:'acct',calendarId:'work',subtle:webcrypto.subtle
});
(async()=>{
    let result=await coord.inspect([source],[],{completeOutlook:true,completeGoogle:true});
    assert.strictEqual(result.candidates.length,1);
    assert.strictEqual(result.candidates[0].state,'needs-explicit-create-authorization');
    assert.strictEqual(result.recovered.length,0);
    await assert.rejects(coord.commitRecovered(result),/unresolved/);
    assert.strictEqual(idCounter,0);
    console.log('✓ missing event becomes candidate only, never triggers a calendar POST');

    lookupMode='found';
    result=await coord.inspect([source],[],{completeOutlook:true,completeGoogle:true});
    assert.strictEqual(result.recovered.length,1);
    assert.strictEqual(result.candidates.length,0);
    const receipt=await coord.commitRecovered(result);
    assert.strictEqual(receipt.state,'recovered');
    assert.strictEqual(idCounter,1);
    assert.strictEqual(current.history.entries[source.uid].state,'active');
    const after=await coord.inspect([source],[{
        id:current.history.entries[source.uid].googleId,summary:source.summary,
        location:source.location,start:{dateTime:source.start},end:{dateTime:source.end}
    }],{completeOutlook:true,completeGoogle:true});
    assert.strictEqual(after.plan.counts.unchanged,1);
    assert.strictEqual(after.plan.counts.add,0);
    console.log('✓ interrupted creation recovered, mapped durably, re-run does not add');

    const stale={...result,headId:'head-0'};
    await assert.rejects(coord.commitRecovered(stale),/History changed/);
    console.log('✓ stale history view blocks second mapping');

    // Different event remains untracked; a renamed Google event cannot be adopted.
    const other={...source,uid:'shift-18'};
    const otherId=await Safety.eventId('acct','work',other.uid,webcrypto.subtle);
    details={id:otherId,summary:'Personally edited shift',location:other.location,
        start:{dateTime:other.start},end:{dateTime:other.end},
        extendedProperties:{private:{calendarBridge:'v1',calendarBridgeUid:other.uid}}};
    result=await coord.inspect([other],[],{completeOutlook:true,completeGoogle:true});
    assert.strictEqual(result.blocked.length,1);
    assert.strictEqual(result.recovered.length,0);
    await assert.rejects(coord.commitRecovered(result),/unresolved/);
    console.log('✓ Google-side edits stop recovery without history mutation');

    details=null;lookupMode='denied';
    await assert.rejects(coord.inspect([other],[],{completeOutlook:true,completeGoogle:true}),/HTTP 403/);
    await assert.rejects(coord.inspect([other],[],{completeOutlook:false,completeGoogle:true}),/Incomplete/);
    assert.throws(()=>Coordinator.makeCoordinator({
        planner:Planner,journal:Journal,safety:Safety,recovery:Recovery,store,
        getById,accountId:'acct',calendarId:'primary',subtle:webcrypto.subtle
    }),/dependencies/);
    console.log('✓ permission failures, incomplete scans, primary calendar all fail closed');

    const before=lookups;
    current={state:'uninitialized',head:null,history:null};
    await assert.rejects(coord.inspect([source],[],{completeOutlook:true,completeGoogle:true}),/Missing initialized/);
    assert.strictEqual(lookups,before);
    assert.strictEqual(typeof coord.create,'undefined');
    console.log('✓ missing history and calendar write methods are strictly absent');
    console.log('All sync coordinator sandbox tests passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
