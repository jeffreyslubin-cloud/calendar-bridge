// Run automatically in GitHub Actions: node test/sync-create-safety.test.js
const assert = require('assert');
const {webcrypto} = require('crypto');
const Safety = require('../sync-create-safety.js');
const source = {uid:'outlook-42',summary:'ER shift',location:'Hershey',
    start:'2026-12-03T21:00:00.000Z',end:'2026-12-04T05:00:00.000Z'};
const history = {version:1,accountId:'account-A',calendarId:'work',entries:{}};
const plan = {actions:{add:[{uid:source.uid}],ambiguous:[],conflict:[]}};
const options = {accountId:'account-A',calendarId:'work',completeOutlook:true,
    completeGoogle:true,expectedHistoryFileId:'history-3',plan,
    googleEvents:[],subtle:webcrypto.subtle};
(async()=>{
    const a = await Safety.prepareAdd(source,history,options);
    const b = await Safety.prepareAdd(source,history,options);
    assert.strictEqual(a.state,'candidate-only');
    assert.strictEqual(a.id,b.id);
    assert.match(a.id,/^cb[0-9a-v]{52}$/);
    assert.strictEqual(a.event.extendedProperties.private.calendarBridgeUid,source.uid);
    assert.strictEqual(a.event.start.dateTime,source.start);
    console.log('✓ deterministic event ID and private UID marker');

    const another = await Safety.prepareAdd({...source,uid:'another-uid'},
        history,{...options,plan:{actions:{add:[{uid:'another-uid'}]}}});
    assert.notStrictEqual(a.id,another.id);
    const changedCalendar = await Safety.eventId('account-A','other',source.uid,webcrypto.subtle);
    assert.notStrictEqual(a.id,changedCalendar);
    console.log('✓ different Outlook identity and destination produce different IDs');

    const retry = await Safety.prepareAdd(source,history,
        {...options,googleEvents:[{id:a.id,summary:'Manual Google correction'}]});
    assert.strictEqual(retry.state,'reconcile-existing');
    assert.strictEqual(retry.event,undefined);
    console.log('✓ prior Google event blocks automatic retry creation');

    await assert.rejects(Safety.prepareAdd(source,history,
        {...options,calendarId:'primary'}),/Unsafe/);
    await assert.rejects(Safety.prepareAdd(source,history,
        {...options,completeGoogle:false}),/Unsafe/);
    await assert.rejects(Safety.prepareAdd(source,history,
        {...options,expectedHistoryFileId:null}),/Unsafe/);
    await assert.rejects(Safety.prepareAdd(source,history,
        {...options,plan:{actions:{add:[]}}}),/not authorized/);
    await assert.rejects(Safety.prepareAdd(source,{
        ...history,entries:{[source.uid]:{state:'excluded'}}
    },options),/not authorized/);
    await assert.rejects(Safety.prepareAdd({...source,end:source.start},
        history,options),/Invalid event/);
    console.log('✓ unknown, deleted, incomplete and primary-calendar inputs rejected');
    assert.strictEqual(typeof Safety.insert,'undefined');
    console.log('✓ no live calendar writing method exposed');
    console.log('All creation safety tests passed.');
})().catch(e=>{ console.error(e); process.exitCode=1; });
