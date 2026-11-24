// Run: node test/sync-planner.test.js
const assert = require('assert');
const S = require('../sync-planner.js');
const opts = { calendarId: 'work', completeOutlook: true, completeGoogle: true };
const e = { uid: 'outlook-1', summary: 'ER shift',
    start: '2026-12-11T21:00:00.000Z', end: '2026-12-12T05:00:00.000Z', location: 'Hershey' };
const g = { id: 'google-1', iCalUID: 'different-import-uid', summary: 'ER shift',
    start: { dateTime: '2026-12-11T16:00:00-05:00' },
    end: { dateTime: '2026-12-12T00:00:00-05:00' }, location: 'Hershey' };
const initial = S.emptyHistory('work');
assert.strictEqual(S.plan([e], [], initial, opts).counts.add, 1);
assert.strictEqual(S.plan([e], [g], initial, opts).counts.adopt, 1);
assert.strictEqual(S.plan([e], [g], initial, opts).actions.adopt[0].match, 'unique-title-and-time');
console.log('✓ unique imported ICS match can be adopted, not duplicated');

const adopted = S.recordAdoption(initial, e.uid, g.id, e);
assert.strictEqual(S.plan([e], [g], adopted, opts).counts.unchanged, 1);
assert.strictEqual(S.plan([{...e, summary:'Updated source'}], [g], adopted, opts).counts.updateCandidate, 1);
console.log('✓ prior identity prevents duplicate and tracks source changes');

const renamed = {...g, summary: 'My corrected title'};
assert.strictEqual(S.plan([e], [renamed], adopted, opts).counts.conflict, 1);
assert.strictEqual(S.plan([{...e, summary:'Updated source'}], [renamed], adopted, opts).counts.conflict, 1);
console.log('✓ manual Google title corrections never overwritten silently');

const missing = S.plan([e], [], adopted, opts);
assert.strictEqual(missing.counts.verifyMissing, 1);
assert.strictEqual(missing.counts.add, 0);
assert.throws(() => S.confirmDeletion(adopted, e.uid, g.id, {firstStatus:404,secondStatus:404,calendarAccessible:false}), /not verified/);
assert.throws(() => S.confirmDeletion(adopted, e.uid, 'wrong-id', {eventStatus:'cancelled'}), /unknown/);
console.log('✓ missing in search is NOT automatic deletion; unauthorized 404 never tombstones');

const excluded = S.confirmDeletion(adopted, e.uid, g.id, {firstStatus:404,secondStatus:404,calendarAccessible:true});
assert.strictEqual(S.plan([e], [], excluded, opts).counts.excluded, 1);
assert.strictEqual(S.plan([e], [], excluded, opts).counts.add, 0);
assert.strictEqual(S.plan([e], [g], excluded, opts).counts.excluded, 1);
assert.strictEqual(adopted.entries[e.uid].state, 'active');
console.log('✓ verified deletion becomes durable exclusion; inputs not mutated');

assert.throws(() => S.plan([e], [], null, opts), /history/);
assert.throws(() => S.plan([e], [], initial, {...opts, calendarId: 'primary'}), /history/);
assert.throws(() => S.plan([e], [], initial, {...opts, completeOutlook: false}), /complete/);
assert.throws(() => S.plan([e], [], initial, {...opts, completeGoogle: false}), /complete/);
assert.throws(() => S.plan([{...e, summary: ''}], [], initial, opts), /Incomplete Outlook/);
console.log('✓ incomplete scans, blank titles, lost history and wrong calendar fail closed');

assert.strictEqual(S.plan([e, {...e, uid:'outlook-2'}], [g], initial, opts).counts.ambiguous, 2);
assert.strictEqual(S.plan([e], [g, {...g, id:'google-2'}], initial, opts).counts.ambiguous, 1);
console.log('✓ repeated source IDs, same-time names, multi-Google matches fail closed');

assert.throws(() => S.recordAdoption(adopted, e.uid, 'another-id', e), /overwrite/);
assert.throws(() => S.recordAdoption(adopted, 'other-uid', g.id, e), /already mapped/);
console.log('✓ mapping cannot silently overwrite a prior record');

const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname,'..','sync-planner.js'),'utf8');
assert(!/\bfetch\s*\(/.test(code));
assert(!/chrome\./.test(code));
console.log('✓ planner contains no network or Chrome write operations');
console.log('All sync planner tests passed.');
