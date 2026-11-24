const assert=require('assert');
const {webcrypto}=require('crypto');
const Backup=require('../google-backup.js');
const Verify=require('../sync-backup-verify.js');
const fs=require('fs'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','popup.html'),'utf8');
assert(html.includes('id="googleBackupFile"'));
assert(html.includes('src="sync-backup-verify-ui.js"'));
(async()=>{
 const meta={id:'dedicated-work',summary:'Work',accessRole:'owner'};
 const mock=async(url)=>({
    ok:true,status:200,
    json:async()=>url.includes('/events')?{items:[{id:'one'}]}:meta
 });
 const service=Backup.makeBackup(mock,'test',{subtle:webcrypto.subtle});
 const actual=(await service.capture('dedicated-work')).backup;
 let valid=await Verify.verifySelection(actual,'dedicated-work',service);
 assert.strictEqual(valid.state,'backup-verified-for-selection');
 assert.strictEqual(valid.eventCount,1);
 await assert.rejects(Verify.verifySelection(actual,'other-calendar',service),/different/);
 await assert.rejects(Verify.verifySelection(actual,'primary',service),/non-primary/);
 const tampered=JSON.parse(JSON.stringify(actual));
 tampered.events.push({id:'injected'});
 await assert.rejects(Verify.verifySelection(tampered,'dedicated-work',service),/checksum mismatch/);
 const readOnly={...actual,calendar:{...actual.calendar,accessRole:'reader'}};
 // Re-sign altered metadata to verify role check is independent of checksum.
 const readOnlyStore=Backup.makeBackup(async()=>({ok:true,json:async()=>({})}),'test',{subtle:webcrypto.subtle});
 const fakeVerifier={verify:async()=>true};
 await assert.rejects(Verify.verifySelection(readOnly,'dedicated-work',fakeVerifier),/not writable/);
 console.log('✓ saved backup validates checksum, selected calendar and write permission');
 console.log('✓ wrong calendar, primary, tampering and read-only roles rejected');
 console.log('All saved backup verification tests passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
