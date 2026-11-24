// node test/sync-transaction-sandbox.test.js
// Entire test runs in memory; there are NO network calls.
const assert=require('assert');
const {webcrypto}=require('crypto');
const Planner=require('../sync-planner.js');
const Journal=require('../history-journal.js');
const Safety=require('../sync-create-safety.js');
const Recovery=require('../sync-create-recovery.js');
const Intent=require('../sync-create-intent.js');
const Transaction=require('../sync-transaction-sandbox.js');
const source={uid:'outlook-shift-1',summary:'ER shift',location:'Hershey',
    start:'2026-12-12T21:00:00.000Z',end:'2026-12-13T05:00:00.000Z'};
const empty=()=>({version:1,accountId:'acct',calendarId:'work',entries:{}});
function harness(mode) {
    let history=empty(),headId='head-0',revision=0,posts=0,reads=0;
    let google=null,postMode=mode||'normal',writeFailed=false;
    const store={
        async read(){return {state:'loaded',head:{fileId:headId},
            history:JSON.parse(JSON.stringify(history))};},
        async append(expected,next) {
            assert.strictEqual(expected,headId);
            Journal.validHistory(next);
            history=JSON.parse(JSON.stringify(next));
            headId='head-'+(++revision);
            return {fileId:headId};
        }
    };
    const reader={async getById(id) {
        reads++;
        if(!google)return {state:'not-found-unconfirmed',status:404};
        return {state:'found',event:{...google,id}};
    }};
    const writer={async insertOnce(event) {
        posts++;
        assert.strictEqual(history.entries[source.uid].state,'pending',
            'pending intent must be durable before POST');
        assert.strictEqual(event.extendedProperties.private.calendarBridgeUid,source.uid);
        if(postMode==='lost-and-created') {
            google=event;
            return {state:'unknown-outcome',reason:'network-error'};
        }
        if(postMode==='never-created')return {state:'unknown-outcome',reason:'http-503'};
        if(postMode==='manual-edit') {
            google={...event,summary:'My corrected title'};
            return {state:'insert-reported-success',id:event.id};
        }
        google=event;
        return {state:'insert-reported-success',id:event.id};
    }};
    const transaction=()=>Transaction.makeTransaction({store,planner:Planner,journal:Journal,
        safety:Safety,recovery:Recovery,intent:Intent,reader,writer,accountId:'acct',
        calendarId:'work',subtle:webcrypto.subtle});
    return {transaction,store,reader,writer,setGoogle:g=>google=g,
        setMode:m=>postMode=m,get state(){return {history,headId,posts,reads,revision}}};
}
const scan={completeOutlook:true,completeGoogle:true};
(async()=>{
    const normal=harness();
    const created=await normal.transaction().create(source,[source],[],scan);
    assert.strictEqual(created.state,'created-and-mapped');
    assert.strictEqual(normal.state.posts,1);
    assert.strictEqual(normal.state.revision,2);
    assert.strictEqual(normal.state.history.entries[source.uid].state,'active');
    await assert.rejects(normal.transaction().create(source,[source],[],scan),/Planner refused/);
    assert.strictEqual(normal.state.posts,1);
    console.log('✓ create: persist pending, POST once, verify GET, finalize history');

    const dropped=harness('lost-and-created');
    const afterLost=await dropped.transaction().create(source,[source],[],scan);
    assert.strictEqual(afterLost.state,'created-and-mapped');
    assert.strictEqual(dropped.state.posts,1);
    console.log('✓ lost POST response with successful server creation is recovered by GET');

    const stopped=harness('never-created');
    const unknown=await stopped.transaction().create(source,[source],[],scan);
    assert.strictEqual(unknown.state,'pending-review');
    assert.strictEqual(stopped.state.history.entries[source.uid].state,'pending');
    assert.strictEqual(stopped.state.posts,1);
    const restart=stopped.transaction();
    const pending=await restart.resumePending(source.uid);
    assert.strictEqual(pending.state,'pending-review');
    assert.strictEqual(stopped.state.posts,1);
    assert.strictEqual(Planner.plan([source],[],stopped.state.history,
        {calendarId:'work',completeOutlook:true,completeGoogle:true}).counts.add,0);
    console.log('✓ server 503 leaves durable pending; restart never retries POST');

    const edited=harness('manual-edit');
    const manual=await edited.transaction().create(source,[source],[],scan);
    assert.strictEqual(manual.state,'pending-review');
    assert.strictEqual(edited.state.history.entries[source.uid].state,'pending');
    assert.strictEqual(edited.state.posts,1);
    console.log('✓ user-edited event remains pending, with edits untouched');

    const invalid=harness();
    await assert.rejects(invalid.transaction().create(source,[source,{...source}],[],scan),
        /ambiguous/);
    await assert.rejects(invalid.transaction().create(source,[source],[],
        {...scan,completeOutlook:false}),/Incomplete/);
    assert.strictEqual(invalid.state.revision,0);
    assert.strictEqual(invalid.state.posts,0);
    console.log('✓ duplicate Outlook IDs and incomplete scans block even pending intent');

    // Pending entry that was created in a prior session with a real server event:
    // resume may safely map it, but MUST NOT create again.
    const resumed=harness('never-created');
    await resumed.transaction().create(source,[source],[],scan);
    const id=resumed.state.history.entries[source.uid].googleId;
    resumed.setGoogle({id,summary:source.summary,location:source.location,
        start:{dateTime:source.start},end:{dateTime:source.end},
        extendedProperties:{private:{calendarBridge:'v1',calendarBridgeUid:source.uid}}});
    const recovered=await resumed.transaction().resumePending(source.uid);
    assert.strictEqual(recovered.state,'created-and-mapped');
    assert.strictEqual(resumed.state.posts,1);
    assert.strictEqual(resumed.state.history.entries[source.uid].state,'active');
    console.log('✓ crash recovery maps verified existing event with no second POST');

    assert.strictEqual(typeof resumed.transaction().delete,'undefined');
    assert.strictEqual(typeof resumed.transaction().update,'undefined');
    console.log('✓ no event delete/update methods; no real credentials or API calls');
    console.log('All transaction sandbox tests passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
