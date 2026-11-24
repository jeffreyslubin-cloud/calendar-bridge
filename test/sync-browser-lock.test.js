const assert=require('assert');
const Lock=require('../sync-browser-lock.js');
let active=0,max=0;
let tail=Promise.resolve();
const fakeLocks={
    request:async(key,options,fn)=>{
        assert.strictEqual(key,'calendar-bridge-sync:acct:work');
        assert.strictEqual(options.mode,'exclusive');
        // Model Web Locks exclusive queuing, even across two lock adapters.
        const prior=tail;
        let release;
        tail=new Promise(resolve=>release=resolve);
        await prior;
        try{return await fn();}finally{release();}
    }
};
const a=Lock.makeLock(fakeLocks),b=Lock.makeLock(fakeLocks);
(async()=>{
 const runs=Array.from({length:5},(_,i)=>
    (i%2?a:b).runExclusive('acct','work',async()=>{
        active++;max=Math.max(active,max);
        await Promise.resolve();
        active--;
        return i;
    }));
 assert.deepStrictEqual(await Promise.all(runs),[0,1,2,3,4]);
 assert.strictEqual(max,1);
 assert.throws(()=>Lock.makeLock(null),/unavailable/);
 await assert.rejects(a.runExclusive('acct','primary',async()=>{}),/Invalid/);
 console.log('✓ concurrent browser-local runs are serialized');
 console.log('✓ unavailable Web Locks and primary calendar fail closed');
 console.log('All browser lock tests passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
