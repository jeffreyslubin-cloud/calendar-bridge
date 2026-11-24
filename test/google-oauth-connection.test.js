// Run: node test/google-oauth-connection.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const popup = read('popup.html');
const code = read('google-connection.js');
assert(manifest.permissions.includes('identity'));
assert(manifest.host_permissions.includes('https://www.googleapis.com/*'));
assert.strictEqual(manifest.oauth2.client_id, '310426066702-57gh8b1ml4si090ejul6ohf6coii909l.apps.googleusercontent.com');
assert.deepStrictEqual(manifest.oauth2.scopes, [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/drive.appdata'
]);
assert(popup.includes('id="googleConnectButton"'));
assert(popup.includes('<script src="google-connection.js"></script>'));
assert(code.includes('chrome.identity.getAuthToken({ interactive: true })'));
assert(code.includes('maxResults=1&fields=kind'));
assert(code.includes("method: 'GET'"));
assert(!/method:\s*['"](?:POST|PATCH|PUT|DELETE)['"]/.test(code));
assert(!code.includes('chrome.storage'));
console.log('✓ Google OAuth manifest and popup wired');
console.log('✓ connection test is GET-only and stores no token');
console.log('All Google connection tests passed.');
