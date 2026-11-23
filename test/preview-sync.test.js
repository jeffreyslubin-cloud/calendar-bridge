// Run: node test/preview-sync.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const { parseICS, compare } = require('../preview-compare.js');

const ics = ['BEGIN:VCALENDAR','BEGIN:VEVENT','UID:cal-liberator-shift@outlook.com',
    'SUMMARY:Evening shift','LOCATION:ER','DTSTART:20261211T210000Z',
    'DTEND:20261212T050000Z','END:VEVENT','BEGIN:VEVENT',
    'UID:cal-liberator-off@outlook.com','SUMMARY:Day off',
    'DTSTART;VALUE=DATE:20261214','DTEND;VALUE=DATE:20261215',
    'END:VEVENT','END:VCALENDAR'].join('\r\n');
const out = parseICS(ics);
assert.strictEqual(out.length, 2);
assert.strictEqual(out[0].start, '2026-12-11T21:00:00.000Z');
assert.strictEqual(out[0].end, '2026-12-12T05:00:00.000Z');
assert.strictEqual(out[1].start, '2026-12-14');
assert.strictEqual(out[1].end, '2026-12-15');
console.log('✓ overnight and all-day ICS parsing');

const googleShift = { id: 'abc', iCalUID: out[0].uid, summary: 'Evening shift',
    location: 'ER', start: { dateTime: '2026-12-11T16:00:00-05:00' },
    end: { dateTime: '2026-12-12T00:00:00-05:00' } };
let result = compare(out, [googleShift]);
assert.strictEqual(result.unchanged.length, 1);
assert.strictEqual(result.add.length, 1);
console.log('✓ previously imported ICS UID matches with timezone offsets');

result = compare(out, [{...googleShift, summary: 'Changed name'}]);
assert.strictEqual(result.update.length, 1);
assert.strictEqual(result.update[0].googleId, 'abc');
console.log('✓ same UID with different event details is an update candidate');

const duplicate = { ...googleShift, iCalUID: 'another-uid' };
result = compare(out, [duplicate]);
assert.strictEqual(result.possibleDuplicates.length, 1);
assert.strictEqual(result.add.length, 1);
console.log('✓ same title and times with unrelated UID is a potential duplicate');

result = compare(out, [googleShift, { ...googleShift, id: 'second' }]);
assert.strictEqual(result.ambiguous.length, 1);
assert.strictEqual(result.update.length, 0);
console.log('✓ multiple matches never selected for an automatic update');

result = compare([out[0], out[0]], []);
assert.strictEqual(result.ambiguous.length, 2);
assert.strictEqual(result.add.length, 0);
console.log('✓ repeated Outlook UIDs never counted as safe additions');

result = compare(out, [{...googleShift, status: 'cancelled'}]);
assert.strictEqual(result.add.length, 2);
console.log('✓ cancelled events ignored');

assert.throws(() => parseICS('BEGIN:VEVENT\nSUMMARY:Broken\nEND:VEVENT'), /incomplete/);
console.log('✓ incomplete source data prevents preview');

const preview = read('google-preview.js');
const content = read('content.js');
const html = read('popup.html');
const manifest = JSON.parse(read('manifest.json'));
assert(html.includes('id="googlePreviewButton"'));
assert(html.includes('id="googleCalendarId"'));
assert(html.includes('src="preview-compare.js"'));
assert(html.includes('src="google-preview.js"'));
assert(preview.includes("method: 'GET'"));
assert(!/method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/.test(preview));
assert(!preview.includes('chrome.storage'));
assert(content.includes("this.destination === 'preview'"));
assert(content.includes("{ delivery: 'preview', ics: icsContent }"));
assert(manifest.permissions.includes('identity'));
console.log('✓ read-only preview wired without Google write calls');
console.log('All preview sync tests passed.');
