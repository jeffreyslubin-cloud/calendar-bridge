// Run: node test/sync-create-recovery.test.js
const assert=require('assert');
const {webcrypto}=require('crypto');
const Safety=require('../sync-create-safety.js');
const Recovery=require('../sync-create-recovery.js');
const source={uid:'outlook-a',summary:'ER shift',location:'Hershey',
    start:'2026-12-11T21:00:00.000Z',end:'2026-12-12T05:00:00.000Z'};
(async()=>{
    const id=await Safety.eventId('account-A','work',source.uid,webcrypto.subtle);
    const existing={id,summary:source.summary,location:source.location,status:'confirmed',
        start:{dateTime:'2026-12-11T16:00:00-05:00'},
        end:{dateTime:'2026-12-12T00:00:00-05:00'},
        extendedProperties:{private:{calendarBridge:'v1',calendarBridgeUid:source.uid}}};
    const idFactory=(a,c,u)=>Safety.eventId(a,c,u,webcrypto.subtle);
    let calls=[];
    let status=200, event=existing;
    const fetchMock=async(url,opts)=>{
        calls.push({url,opts});
        assert.strictEqual(opts.method,'GET');
        assert.strictEqual(opts.cache,'no-store');
        assert.strictEqual(opts.headers.Authorization,'Bearer token');
        assert(url.includes('/calendar/v3/calendars/work/events/'));
        return {ok:status>=200&&status<300,status,json:async()=>event};
    };
    let result=await Recovery.checkById(fetchMock,'token','account-A','work',source,id,idFactory);
    assert.strictEqual(result.state,'safe-to-record-existing');
    assert.strictEqual(result.fields.start,source.start);
    console.log('✓ exact GET-by-ID validates event identity, times, location and ownership');

    for (const changed of [
        {...existing,summary:'My edited title'},
        {...existing,location:'Changed location'},
        {...existing,start:{dateTime:'2026-12-11T17:00:00-05:00'}},
        {...existing,extendedProperties:{private:{calendarBridge:'v1',calendarBridgeUid:'other'}}},
        {...existing,extendedProperties:undefined},
        {...existing,recurringEventId:'parent-id'},
        {...existing,status:'cancelled'}
    ]) {
        const found=Recovery.inspectRecoveredEvent(id,source,changed);
        assert.strictEqual(found.state,'blocked');
    }
    assert.throws(()=>Recovery.inspectRecoveredEvent(id,source,{...existing,id:'different-id'}),/Unexpected/);
    console.log('✓ edits, missing ownership marker, cancellations and recurrence all blocked');

    status=404;
    result=await Recovery.checkById(fetchMock,'token','account-A','work',source,id,idFactory);
    assert.strictEqual(result.state,'not-found-unconfirmed');
    status=410;
    result=await Recovery.checkById(fetchMock,'token','account-A','work',source,id,idFactory);
    assert.strictEqual(result.state,'not-found-unconfirmed');
    status=403;
    await assert.rejects(Recovery.checkById(fetchMock,'token','account-A','work',source,id,idFactory),/HTTP 403/);
    status=500;
    await assert.rejects(Recovery.checkById(fetchMock,'token','account-A','work',source,id,idFactory),/HTTP 500/);
    console.log('✓ missing and gone events never authorize creation; permissions and server errors stop');

    status=200;
    await assert.rejects(Recovery.checkById(fetchMock,'token','account-A','primary',source,id,idFactory),/authorization/);
    await assert.rejects(Recovery.checkById(fetchMock,'token','account-A','work',source,'wrong-id',idFactory),/identity mismatch/);
    assert.strictEqual(typeof Recovery.create,'undefined');
    assert.strictEqual(typeof Recovery.delete,'undefined');
    assert.strictEqual(calls.filter(c=>c.opts.method!=='GET').length,0);
    console.log('✓ primary calendar and wrong identities rejected; zero writes');
    console.log('All create recovery tests passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
