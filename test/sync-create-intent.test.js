const assert=require('assert');
const Journal=require('../history-journal.js');
const Planner=require('../sync-planner.js');
const Intent=require('../sync-create-intent.js');
const source={uid:'uid-1',summary:'ER shift',location:'Hershey',
    start:'2026-12-01T21:00:00.000Z',end:'2026-12-02T05:00:00.000Z'};
const empty={version:1,accountId:'acct',calendarId:'work',entries:{}};
const pending=Intent.begin(empty,source.uid,'google-id',source,Journal.validHistory);
assert.strictEqual(empty.entries[source.uid],undefined);
assert.strictEqual(pending.entries[source.uid].state,'pending');
assert.doesNotThrow(()=>Journal.validHistory(pending));
assert.doesNotThrow(()=>Planner.validateHistory(pending,'work'));
const planned=Planner.plan([source],[],pending,
    {calendarId:'work',completeOutlook:true,completeGoogle:true});
assert.strictEqual(planned.counts.add,0);
assert.strictEqual(planned.counts.verifyMissing,1);
assert.throws(()=>Intent.begin(pending,source.uid,'another-id',source,Journal.validHistory),/already/);
const verified={state:'safe-to-record-existing',id:'google-id',fields:{
    summary:source.summary,location:source.location,start:source.start,end:source.end}};
const active=Intent.complete(pending,source.uid,'google-id',verified,Journal.validHistory);
assert.strictEqual(active.entries[source.uid].state,'active');
assert.strictEqual(pending.entries[source.uid].state,'pending');
assert.throws(()=>Intent.complete(pending,source.uid,'google-id',{
    ...verified,fields:{...verified.fields,summary:'edited'}
},Journal.validHistory),/differs/);
assert.throws(()=>Intent.complete(pending,source.uid,'wrong',verified,Journal.validHistory),/cannot/);
assert.throws(()=>Intent.complete(pending,source.uid,'google-id',{
    ...verified,state:'blocked'
},Journal.validHistory),/cannot/);
console.log('✓ pending intent accepted by both validators and blocks new creation');
console.log('✓ only exactly verified existing event can finalize into active mapping');
console.log('All pending intent tests passed.');
