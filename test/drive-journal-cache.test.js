const assert=require('assert');
const Journal=require('../history-journal.js');
const Drive=require('../drive-journal.js');
const history={version:1,accountId:'acct',calendarId:'work',entries:{}};
let objects=[],seq=0,gets=0,modified=false;
const respond=data=>({ok:true,status:200,json:async()=>data});
async function fetchMock(url,options){
 if(options.method==='POST'){
    const chunks=options.body.split('\r\n\r\n');
    const metadata=JSON.parse(chunks[1].split('\r\n--')[0]);
    const data=JSON.parse(chunks[2].split('\r\n--')[0]);
    const id='id'+(++seq);
    objects.push({id,name:metadata.name,modifiedTime:'2026-11-24T22:00:00.000Z',
        md5Checksum:id.padEnd(32,'a'),size:'100',data});
    return respond({id});
 }
 if(url.includes('alt=media')){
    gets++;
    const id=decodeURIComponent(url.match(/\/files\/([^?]+)/)[1]);
    return respond(objects.find(o=>o.id===id).data);
 }
 return respond({files:objects.map(({id,name,modifiedTime,md5Checksum,size})=>({
    id,name,modifiedTime,md5Checksum,size}))});
}
(async()=>{
 const store=Drive.makeStore(fetchMock,'token',Journal,()=>String(seq+1)+'uuid');
 let head=null;
 for(let i=0;i<8;i++){
   const receipt=await store.append(head,history,'acct','work');
   head=receipt.fileId;
 }
 assert.strictEqual(objects.length,8);
 assert.strictEqual(gets,8,'Only new snapshots should require media downloads');
 const result=await store.read('acct','work');
 assert.strictEqual(result.count,8);
 assert.strictEqual(gets,8);
 console.log('✓ repeated snapshots validated with one media GET per new generation');

 objects[0].md5Checksum='changed-hash';
 await assert.rejects(store.read('acct','work'),/modified/);
 console.log('✓ immutable snapshot modification detected, not silently accepted');
 console.log('All Drive journal caching tests passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
