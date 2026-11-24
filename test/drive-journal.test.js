// Run: node test/drive-journal.test.js. All Google Drive calls are mocked.
const assert = require('assert');
const J = require('../history-journal.js');
const D = require('../drive-journal.js');
const H = {version:1,accountId:'acct',calendarId:'work',entries:{}};
const files = [];
let nextId = 1;
const calls = [];
const response = data => ({ok:true,status:200,json:async()=>data});
const fetchMock = async(url, options) => {
    calls.push({url,options});
    assert.strictEqual(options.headers.Authorization,'Bearer mock-token');
    if (options.method === 'POST') {
        assert(url.includes('uploadType=multipart'));
        assert(options.body.includes('appDataFolder'));
        const meta = JSON.parse(options.body.split('\r\n\r\n')[1].split('\r\n--')[0]);
        const payload = JSON.parse(options.body.split('\r\n\r\n')[2].split('\r\n--')[0]);
        const id = 'id' + nextId++;
        files.push({id,name:meta.name,data:payload});
        return response({id});
    }
    if (url.includes('alt=media')) {
        const id = decodeURIComponent(url.match(/\/files\/([^?]+)/)[1]);
        return response(files.find(f=>f.id===id).data);
    }
    return response({files:files.map(f=>({id:f.id,name:f.name}))});
};
(async()=>{
    const store = D.makeStore(fetchMock,'mock-token',J,()=>String(nextId) + 'uuid');
    assert.strictEqual((await store.read('acct','work')).state,'uninitialized');
    const first = await store.append(null,H,'acct','work');
    assert.strictEqual(first.generation,0);
    const second = await store.append(first.fileId,H,'acct','work');
    assert.strictEqual(second.generation,1);
    assert.strictEqual((await store.read('acct','work')).count,2);
    assert.strictEqual(files[0].data.previousFileId,null);
    assert.strictEqual(files[1].data.previousFileId,first.fileId);
    await assert.rejects(store.append(first.fileId,H,'acct','work'),/changed/);
    assert.strictEqual(files.length,2);
    assert(calls.every(c=>c.options.cache==='no-store'));
    console.log('✓ two immutable saved snapshots; old head cannot overwrite');

    await assert.rejects(store.read('wrong','work'),/different account/);
    await assert.rejects(store.append(second.fileId,{...H,calendarId:'primary'},'acct','work'),/mismatch/);
    console.log('✓ account and calendar mismatch fail safely');
    const fork = J.snapshot(1,first.fileId,H,new Date().toISOString());
    files.push({id:'fork',name:D.PREFIX+'0000001-fork.json',data:fork});
    await assert.rejects(store.read('acct','work'),/Concurrent/);
    await assert.rejects(store.append(second.fileId,H,'acct','work'),/Concurrent/);
    console.log('✓ racing writers are detected and future appends blocked');
    console.log('All Drive journal tests passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
