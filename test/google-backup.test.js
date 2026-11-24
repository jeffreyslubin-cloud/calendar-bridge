// Fully mocked API. Run automatically in CI.
const assert=require('assert');
const {webcrypto}=require('crypto');
const Backup=require('../google-backup.js');
const fs=require('fs');
const path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','popup.html'),'utf8');
const ui=fs.readFileSync(path.join(__dirname,'..','google-backup-ui.js'),'utf8');
assert(html.includes('id="googleBackupButton"'));
assert(html.indexOf('src="google-backup.js"')<html.indexOf('src="google-backup-ui.js"'));
assert(ui.includes('chrome.identity.getAuthToken({interactive:true})'));
assert(ui.includes('service.verify(JSON.parse(json))'));
const metadata={id:'work-123',summary:'Work Calendar',timeZone:'America/New_York',accessRole:'owner'};
const recurring={id:'recurring-master',summary:'Recurring shift',
    start:{dateTime:'2026-12-01T12:00:00-05:00'},
    recurrence:['RRULE:FREQ=WEEKLY']};
const event={id:'one-time',summary:'ER shift',
    start:{dateTime:'2026-12-02T12:00:00-05:00'}};
let calls=[],responseError=false,brokenPage=false,duplicate=false,wrongCalendar=false;
const respond=(value,status=200)=>({status,ok:status===200,json:async()=>value});
const fetchMock=async(url,options)=>{
    calls.push({url,options});
    assert.strictEqual(options.method,'GET');
    assert.strictEqual(options.headers.Authorization,'Bearer mocked-token');
    if(responseError)return respond({},403);
    if(url.includes('/events')) {
        const parsed=new URL(url);
        assert.strictEqual(parsed.searchParams.get('singleEvents'),'false');
        assert.strictEqual(parsed.searchParams.get('showDeleted'),'false');
        if(parsed.searchParams.get('pageToken')) {
            return respond({items:brokenPage?undefined:duplicate?[event]:[event]});
        }
        return respond({items:[recurring],nextPageToken:'second-page'});
    }
    return respond({...metadata,id:wrongCalendar?'other':metadata.id});
};
(async()=>{
    const store=Backup.makeBackup(fetchMock,'mocked-token',{subtle:webcrypto.subtle});
    let result=await store.capture('work-123');
    assert.strictEqual(result.eventCount,2);
    assert.deepStrictEqual(result.backup.events[0].recurrence,recurring.recurrence);
    assert.strictEqual(await store.verify(result.backup),true);
    assert.match(result.sha256,/^[a-f0-9]{64}$/);
    console.log('✓ all pages and recurring master retained; SHA-256 verified');

    const modified=JSON.parse(JSON.stringify(result.backup));
    modified.events[0].summary='tampered';
    await assert.rejects(store.verify(modified),/checksum mismatch/);
    console.log('✓ tampered backup is rejected');

    responseError=true;
    await assert.rejects(store.capture('work-123'),/HTTP 403/);
    responseError=false;brokenPage=true;
    await assert.rejects(store.capture('work-123'),/incomplete event page/);
    brokenPage=false;wrongCalendar=true;
    await assert.rejects(store.capture('work-123'),/identity mismatch/);
    console.log('✓ authorization, pagination and calendar identity failures abort');

    wrongCalendar=false;duplicate=true;
    // Duplicate from the second page must be rejected when it matches the first.
    const duplicateFetch=async(url,opts)=>{
        if(!url.includes('/events'))return respond(metadata);
        const parsed=new URL(url);
        return parsed.searchParams.has('pageToken')?
            respond({items:[recurring]}):respond({items:[recurring],nextPageToken:'next'});
    };
    const duplicateStore=Backup.makeBackup(duplicateFetch,'mocked-token',{subtle:webcrypto.subtle});
    await assert.rejects(duplicateStore.capture('work-123'),/duplicate event/);
    assert(calls.every(x=>x.options.method==='GET'));
    assert.strictEqual(typeof store.restore,'undefined');
    assert.strictEqual(typeof store.delete,'undefined');
    console.log('✓ duplicate pages blocked and backup has zero calendar write methods');
    console.log('All Google backup tests passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
