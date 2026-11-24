// Regression gate: no live Google Calendar writer can be loaded into Chrome
// without intentionally changing this test and reviewing safety requirements.
const assert=require('assert');
const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('popup.html');
const background=read('background.js');
const manifest=JSON.parse(read('manifest.json'));
const content=manifest.content_scripts.flatMap(x=>x.js);
const loadedScripts=[...html.matchAll(/<script src="([^"]+)"><\/script>/g)]
    .map(m=>m[1]);
for(const forbidden of [
    'sync-insert-isolated.js',
    'sync-transaction-sandbox.js',
    'sync-first-run.js',
    'sync-coordinator-sandbox.js'
]) {
    assert(!loadedScripts.includes(forbidden),'Chrome popup must not load '+forbidden);
    assert(!content.includes(forbidden),'Content script must not load '+forbidden);
    assert(!background.includes(forbidden),'Background must not load '+forbidden);
}
assert(!/calendar\/v3\/calendars\/.*\/events\?sendUpdates/.test(background));
assert(!loadedScripts.some(x=>/writer|insert-isolated|transaction-sandbox/.test(x)));
for(const script of ['google-backup-ui.js','sync-backup-verify-ui.js',
    'sync-readiness-ui.js','google-preview.js']) {
    const code=read(script);
    assert(!/\b(?:POST|PATCH|DELETE)\b/.test(code.replace(/\/\/[^\n]*/g,'')),
        'Read-only UI must not contain calendar mutations: '+script);
}
const scopes=manifest.oauth2.scopes;
assert(scopes.includes('https://www.googleapis.com/auth/calendar.events'));
assert(scopes.includes('https://www.googleapis.com/auth/calendar.calendarlist.readonly'));
assert(scopes.includes('https://www.googleapis.com/auth/drive.appdata'));
assert(!scopes.includes('https://www.googleapis.com/auth/calendar'));
console.log('✓ development-only Calendar writer and initial migration remain unreachable from Chrome');
console.log('✓ read-only UI and least-privilege requested scopes checked');
console.log('All release safety gates passed.');
