const assert=require('assert');
const Identity=require('../sync-device-id.js');
let data={},writes=0,requests=0;
const storage={get:async()=>({...data}),set:async(next)=>{writes++;Object.assign(data,next)}};
let queue=Promise.resolve();
const locks={request:async(name,opts,fn)=>{
 assert.strictEqual(name,'calendar-bridge-device-identity');
 assert.strictEqual(opts.mode,'exclusive');
 requests++;
 const before=queue;let release;
 queue=new Promise(resolve=>release=resolve);
 await before;
 try{return await fn();}finally{release();}
}};
const instance=Identity.makeIdentity(storage,()=> '01234567-89ab-cdef-0123-456789abcdef',locks);
(async()=>{
 const values=await Promise.all(Array.from({length:5},()=>instance.getOrCreate()));
 assert.strictEqual(new Set(values).size,1);
 assert.strictEqual(values[0],'device-0123456789abcdef0123456789abcdef');
 assert.strictEqual(writes,1);
 assert.strictEqual(requests,5);
 assert.strictEqual(await instance.getOrCreate(),values[0]);
 data[Identity.KEY]='corrupt';
 await assert.rejects(instance.getOrCreate(),/recovery required/);
 assert.throws(()=>Identity.makeIdentity(storage,()=> 'x',null),/unavailable/);
 console.log('✓ concurrent first-use initializes one stable browser-local device identity');
 console.log('✓ malformed or unavailable stored identity aborts instead of silently rotating');
 console.log('All browser device identity tests passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
