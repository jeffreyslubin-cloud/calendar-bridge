// Run: node test/drive-history.test.js — all network calls mocked.
const assert = require('assert');
const H = require('../drive-history.js');
const history = { version: 1, calendarId: 'work', entries: {} };
const response = (data, status=200) => ({ ok: status >= 200 && status < 300,
    status, json: async () => data });
(async () => {
    const calls = [];
    let files = [];
    const fakeFetch = async (url, options) => {
        calls.push({url, options});
        assert(options.headers.Authorization === 'Bearer test-token');
        if (options.method === 'POST') {
            assert(url.includes('uploadType=multipart'));
            assert(options.body.includes('appDataFolder'));
            assert(options.body.includes(H.FILE_NAME));
            files = [{id: 'file-123', name: H.FILE_NAME, mimeType: 'application/json'}];
            return response({id:'file-123'});
        }
        if (url.includes('alt=media')) return response(history);
        return response({files});
    };
    const store = H.makeStore(fakeFetch, 'test-token');
    assert.deepStrictEqual(await store.load(), {state:'uninitialized'});
    assert.strictEqual(await store.createOnce(history), 'file-123');
    assert.strictEqual((await store.load()).state, 'loaded');
    await assert.rejects(store.createOnce(history), /already exists/);
    assert(calls.some(c => c.url.includes('spaces=appDataFolder')));
    assert(calls.every(c => c.options.cache === 'no-store'));
    console.log('✓ Drive history listed, created once, and read using mocked API');
    console.log('✓ refuses to overwrite an initialized history');

    const corrupt = H.makeStore(async url => url.includes('alt=media')
        ? response({version:99,entries:{}})
        : response({files:[{id:'bad',name:H.FILE_NAME}]}), 'test');
    await assert.rejects(corrupt.load(), /Corrupt/);
    console.log('✓ corrupt history fails closed');

    const dup = H.makeStore(async () => response({files:[
        {id:'one',name:H.FILE_NAME},{id:'two',name:H.FILE_NAME}]}), 'test');
    await assert.rejects(dup.load(), /Multiple/);
    console.log('✓ duplicate history files trigger recovery, not overwrite');

    const error = H.makeStore(async () => response({}, 403), 'test');
    await assert.rejects(error.load(), /HTTP 403/);
    console.log('✓ authorization and API failures are surfaced');
    console.log('All Drive history tests passed.');
})().catch(e => { console.error(e); process.exitCode = 1; });
