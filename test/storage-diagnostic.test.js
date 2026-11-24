// Run: node test/storage-diagnostic.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
global.crypto = require('crypto').webcrypto;
const D = require('../storage-diagnostic.js');
const popup = fs.readFileSync(path.join(__dirname,'..','popup.html'),'utf8');
const ui = fs.readFileSync(path.join(__dirname,'..','storage-diagnostic-ui.js'),'utf8');
assert(popup.includes('id="driveDiagnosticButton"'));
assert(popup.includes('src="storage-diagnostic.js"'));
assert(popup.indexOf('src="storage-diagnostic.js"') < popup.indexOf('src="storage-diagnostic-ui.js"'));
assert(ui.includes('chrome.identity.getAuthToken({ interactive: true })'));
assert(ui.includes('CalendarBridgeStorageDiagnostic.check(fetch, token)'));
assert(!ui.includes('CalendarBridgeDriveJournal'));
console.log('✓ diagnostic button and OAuth wiring verified');

(async () => {
    const files = [];
    const calls = [];
    let failRead = false;
    const makeResponse = (value, status=200) => ({
        ok: status >= 200 && status < 300, status, json: async()=>value
    });
    const fakeFetch = async (url, options) => {
        calls.push({url, options});
        assert.strictEqual(options.headers.Authorization,'Bearer test-token');
        if (options.method === 'POST') {
            assert(url.includes('uploadType=multipart'));
            assert(options.body.includes("'appDataFolder'") === false);
            assert(options.body.includes('"appDataFolder"'));
            assert(options.body.includes(D.NAME));
            assert(!options.body.includes('calendarId'));
            const id = 'test-only-' + (files.length + 1);
            files.push({id, name:D.NAME});
            return makeResponse({id});
        }
        if (url.includes('alt=media')) {
            if (failRead) return makeResponse({}, 403);
            return makeResponse({marker:D.MARKER, version:1, purpose:'test-only'});
        }
        const parsed = new URL(url);
        assert.strictEqual(parsed.searchParams.get('spaces'),'appDataFolder');
        return makeResponse({files:[...files]});
    };
    let result = await D.check(fakeFetch,'test-token');
    assert.strictEqual(result.state,'created-and-verified');
    assert.strictEqual(files.length,1);
    result = await D.check(fakeFetch,'test-token');
    assert.strictEqual(result.state,'verified-existing');
    assert.strictEqual(files.length,1);
    assert.strictEqual(calls.filter(c=>c.options.method==='POST').length,1);
    console.log('✓ first click creates and verifies exactly one diagnostic file');
    console.log('✓ repeat click reads existing file without another write');

    failRead=true;
    await assert.rejects(D.check(fakeFetch,'test-token'),/HTTP 403/);
    assert.strictEqual(files.length,1);
    console.log('✓ failed verification reports error without rewriting');

    const duplicate = async (url, options) => {
        if (options.method === 'POST') throw Error('Should never create when duplicates found');
        return makeResponse({files:[{id:'one',name:D.NAME},{id:'two',name:D.NAME}]});
    };
    await assert.rejects(D.check(duplicate,'test-token'),/Multiple diagnostic/);
    console.log('✓ duplicate diagnostic files fail closed');

    const incorrect = async (url, options) => {
        if (options.method === 'POST') throw Error('Unexpected write');
        if (url.includes('alt=media')) return makeResponse({marker:'wrong'});
        return makeResponse({files:[{id:'existing',name:D.NAME}]});
    };
    await assert.rejects(D.check(incorrect,'test-token'),/content mismatch/);
    console.log('✓ unrecognized existing content never overwritten');
    console.log('All storage diagnostic tests passed.');
})().catch(e=>{ console.error(e);process.exitCode=1; });
