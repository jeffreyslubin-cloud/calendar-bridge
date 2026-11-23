// Run: node test/stable-extension-id.test.js
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
assert.strictEqual(manifest.name, 'Calendar Bridge');
assert.ok(manifest.key, 'manifest.key is required for a stable unpacked extension ID');
const der = Buffer.from(manifest.key, 'base64');
const publicKey = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
assert.strictEqual(publicKey.asymmetricKeyType, 'rsa');
const prefix = crypto.createHash('sha256').update(der).digest().subarray(0, 16);
const extensionId = Array.from(prefix, byte => 
    String.fromCharCode(97 + (byte >>> 4)) + String.fromCharCode(97 + (byte & 15))
).join('');
const expectedId = 'ahbalbpaicljpgonkijhhplgkojfcijc';
assert.strictEqual(extensionId, expectedId, 'extension identity unexpectedly changed');
console.log('✓ stable extension ID:', extensionId);
console.log('✓ public RSA key is valid; no private key is embedded');
console.log('All stable identity tests passed.');
