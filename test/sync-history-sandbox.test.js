// Run: node test/sync-history-sandbox.test.js
// Simulates actual planner -> Drive journal -> recovery, with zero external requests.
const assert = require('assert');
const Sync = require('../sync-planner.js');
const Journal = require('../history-journal.js');
const Drive = require('../drive-journal.js');
const Sandbox = require('../sync-history-sandbox.js');

const outlook = {
    uid: 'outlook-shift-1', summary: 'Evening ER shift', location: 'Hershey',
    start: '2026-12-11T21:00:00.000Z', end: '2026-12-12T05:00:00.000Z'
};
const google = {
    id: 'google-shift-1', iCalUID: 'different-ics-import-id',
    summary: outlook.summary, location: outlook.location,
    start: {dateTime:'2026-12-11T16:00:00-05:00'},
    end: {dateTime:'2026-12-12T00:00:00-05:00'}
};
const record = { version:1, accountId:'account-A', calendarId:'work', entries:{} };
const files = [];
let idCounter = 0;
const requests = [];
let simulateFailure = false;
const response = (data, status=200) => ({
    ok: status >= 200 && status < 300,
    status, json: async() => data
});
const fetchMock = async(url, opts) => {
    requests.push({url, method:opts.method || 'GET'});
    assert.strictEqual(opts.headers.Authorization, 'Bearer simulated');
    if (simulateFailure) return response({},403);
    if (opts.method === 'POST') {
        assert(url.includes('uploadType=multipart'));
        const parts = opts.body.split('\r\n\r\n');
        const metadata = JSON.parse(parts[1].split('\r\n--')[0]);
        const payload = JSON.parse(parts[2].split('\r\n--')[0]);
        assert(metadata.parents.includes('appDataFolder'));
        const id = 'history-' + (++idCounter);
        files.push({id, name:metadata.name, data:payload});
        return response({id});
    }
    if (url.includes('alt=media')) {
        const id = decodeURIComponent(url.match(/\/files\/([^?]+)/)[1]);
        const entry = files.find(f => f.id === id);
        return entry ? response(entry.data) : response({},404);
    }
    return response({files:files.map(f=>({id:f.id,name:f.name}))});
};

(async () => {
    const store = Drive.makeStore(fetchMock,'simulated', Journal,
        ()=> 'id' + String(idCounter+1) + 'unique');
    const sandbox = Sandbox.createSandbox(Sync, Journal, store,'account-A','work');
    await assert.rejects(sandbox.preview([outlook],[google]),/No initialized/);
    assert.strictEqual(files.length,0);
    console.log('✓ missing history refuses preview and never initializes automatically');

    // The sole initialization is performed by a mocked, explicitly confirmed migration.
    const init = await store.append(null,record,'account-A','work');
    assert.strictEqual(init.generation,0);
    let p = await sandbox.preview([outlook],[google]);
    assert.strictEqual(p.result.counts.adopt,1);
    assert.strictEqual(p.result.counts.add,0);
    console.log('✓ initial migration history loaded; existing ICS event proposed for adoption');

    await assert.rejects(sandbox.adoptExisting('outdated-head',outlook,google),/Stale/);
    const adopted = await sandbox.adoptExisting(init.fileId,outlook,google);
    assert.strictEqual(adopted.state,'adopted');
    assert.strictEqual(files.length,2);
    p = await sandbox.preview([outlook],[google]);
    assert.strictEqual(p.result.counts.unchanged,1);
    assert.strictEqual(p.result.counts.add,0);
    console.log('✓ adopted Google event mapped, saved and recovered from Drive');

    await assert.rejects(sandbox.adoptExisting(adopted.historyFileId,outlook,
        {...google,id:'different-google-id'}),/Event not uniquely adoptable/);
    const renamed = {...google,summary:'My corrected title'};
    assert.strictEqual((await sandbox.preview([outlook],[renamed])).result.counts.conflict,1);
    assert.strictEqual(files.length,2);
    console.log('✓ manual title corrections are preserved and no duplicate mapping created');

    await assert.rejects(sandbox.recordVerifiedDeletion(adopted.historyFileId,
        outlook.uid, google.id, {firstStatus:404,secondStatus:404,calendarAccessible:false}),
        /not verified/);
    assert.strictEqual(files.length,2);
    const deleted = await sandbox.recordVerifiedDeletion(adopted.historyFileId,
        outlook.uid, google.id, {firstStatus:404,secondStatus:404,calendarAccessible:true});
    assert.strictEqual(deleted.state,'excluded');
    p = await sandbox.preview([outlook],[]);
    assert.strictEqual(p.result.counts.excluded,1);
    assert.strictEqual(p.result.counts.add,0);
    assert.strictEqual(files.length,3);
    console.log('✓ verified deletion saved permanently, recovered and never readded');

    // Old snapshots are still present and available for recovery.
    assert.strictEqual(files[0].data.generation,0);
    assert.strictEqual(files[1].data.generation,1);
    assert.strictEqual(files[2].data.generation,2);
    assert.strictEqual(files[2].data.history.entries[outlook.uid].state,'excluded');
    console.log('✓ all historic snapshots remain immutable and recoverable');

    await assert.rejects(sandbox.recordVerifiedDeletion(adopted.historyFileId,
        outlook.uid,google.id,{eventStatus:'cancelled'}),/Stale/);
    assert.strictEqual(files.length,3);
    simulateFailure=true;
    await assert.rejects(sandbox.preview([outlook],[]),/HTTP 403/);
    simulateFailure=false;
    console.log('✓ stale operations and Google permission failures stop safely');

    assert.throws(()=>Sandbox.createSandbox(Sync,Journal,store,'account-A','primary'),/non-primary/);
    assert(requests.every(x => x.url.includes('/drive/v3/files') ||
        x.url.includes('/upload/drive/v3/files')));
    assert(requests.filter(x=>x.method==='POST').length===3);
    console.log('✓ sandbox never calls Google Calendar or writes real appointments');
    console.log('All history integration sandbox tests passed.');
})().catch(e => { console.error(e); process.exitCode=1; });
