const assert=require('assert');
const Writer=require('../sync-insert-isolated.js');
const id='cb'+'0'.repeat(52);
const event={id,summary:'ER shift',start:{dateTime:'2026-12-01T20:00:00Z'},
 end:{dateTime:'2026-12-02T04:00:00Z'},
 extendedProperties:{private:{calendarBridge:'v1',calendarBridgeUid:'source-1'}}};
(async()=>{
  let status=200,payload={id},requests=[];
  const fetchMock=async(url,options)=>{
    requests.push({url,options});
    assert.strictEqual(options.method,'POST');
    assert.strictEqual(options.cache,'no-store');
    assert.strictEqual(options.headers.Authorization,'Bearer test-token');
    assert.strictEqual(JSON.parse(options.body).id,id);
    return {ok:status===200,status,json:async()=>payload};
  };
  const writer=Writer.makeWriter(fetchMock,'test-token','work');
  assert.strictEqual((await writer.insertOnce(event)).state,'insert-reported-success');
  status=409;
  assert.deepStrictEqual(await writer.insertOnce(event),
      {state:'unknown-outcome',reason:'conflict-409'});
  status=503;
  assert.deepStrictEqual(await writer.insertOnce(event),
      {state:'unknown-outcome',reason:'http-503'});
  status=200;payload={id:'wrong'};
  assert.strictEqual((await writer.insertOnce(event)).state,'unknown-outcome');
  assert.strictEqual(requests.length,4);
  assert(requests.every(x=>x.url.includes('sendUpdates=none')));
  assert.throws(()=>Writer.makeWriter(fetchMock,'token','primary'),/Invalid/);
  await assert.rejects(writer.insertOnce({...event,id:'wrong'}),/Invalid/);
  assert.strictEqual(typeof writer.retry,'undefined');
  console.log('✓ POST success, 409 and 503 are single-attempt outcomes');
  console.log('✓ wrong event identity, primary calendar and invalid payload rejected');
  console.log('All isolated insert adapter tests passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
