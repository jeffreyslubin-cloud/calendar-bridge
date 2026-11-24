// Run: node test/history-journal.test.js
const assert = require('assert');
const J = require('../history-journal.js');
const H = {version:1, accountId:'acct1', calendarId:'work', entries:{}};
const s0 = J.snapshot(0, null, H, '2026-11-24T19:00:00.000Z');
const s1 = J.snapshot(1, 'id0', H, '2026-11-24T19:01:00.000Z');
const s2 = J.snapshot(2, 'id1', H, '2026-11-24T19:02:00.000Z');
const record = (fileId, data) => ({fileId, data});
const chain = [record('id0',s0), record('id1',s1), record('id2',s2)];
assert.deepStrictEqual(J.resolve([], 'acct1','work'), {state:'uninitialized',head:null});
const resolved = J.resolve(chain,'acct1','work');
assert.strictEqual(resolved.head.fileId,'id2');
assert.strictEqual(resolved.count,3);
assert.strictEqual(resolved.history.calendarId,'work');
console.log('✓ append-only history resolves from one verified root');

assert.throws(() => J.resolve(chain,'acct2','work'),/different account/);
assert.throws(() => J.resolve(chain,'acct1','personal'),/different account/);
assert.throws(() => J.resolve([chain[1]],'acct1','work'),/root/);
assert.throws(() => J.resolve([chain[0],chain[2]],'acct1','work'),/parent/);
assert.throws(() => J.resolve([chain[0],chain[0]],'acct1','work'),/repeated/);
assert.throws(() => J.resolve([...chain,record('id3',
    J.snapshot(1,'id0',H,'2026-11-24T19:03:00.000Z'))],'acct1','work'),/Concurrent/);
console.log('✓ missing snapshots, forks, wrong account/calendar fail closed');

assert.throws(() => J.snapshot(1,null,H,new Date().toISOString()),/metadata/);
assert.throws(() => J.validHistory({...H,entries:{u:{state:'active'}}}),/entry/);
assert.throws(() => J.validHistory({...H,accountId:''}),/identity/);
const copy = J.snapshot(0,null,H,new Date().toISOString());
H.entries.foo = {state:'excluded'};
assert(!copy.history.entries.foo);
console.log('✓ strict validation and immutable snapshot copy');
console.log('All history journal tests passed.');
