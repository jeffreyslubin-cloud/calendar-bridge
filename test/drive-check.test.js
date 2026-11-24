// Run: node test/drive-check.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = pathName => fs.readFileSync(path.join(root, pathName), 'utf8');
const popup = read('popup.html');
const check = read('drive-check.js');
const adapter = read('drive-history.js');
const manifest = JSON.parse(read('manifest.json'));
assert(popup.includes('id="driveCheckButton"'));
assert(popup.includes('id="driveCheckStatus"'));
assert(popup.indexOf('src="drive-history.js"') < popup.indexOf('src="drive-check.js"'));
assert(manifest.oauth2.scopes.includes('https://www.googleapis.com/auth/drive.appdata'));
assert(manifest.host_permissions.includes('https://www.googleapis.com/*'));
assert(check.includes('chrome.identity.getAuthToken({ interactive: true })'));
assert(check.includes('store.find()'));
assert(!check.includes('store.load()')); // no downloading sensitive history data
assert(!check.includes('store.createOnce('));
assert(!/\b(?:post|put|patch|delete)\s*\(/i.test(check));
assert(!/\b(?:post|put|patch|delete)\s*\(/i.test(adapter.slice(0,adapter.indexOf('async function createOnce'))));
console.log('✓ popup includes separate Drive connection check');
console.log('✓ Drive OAuth scope and script loading verified');
console.log('✓ button checks hidden storage using GET only');
console.log('All Drive check tests passed.');
