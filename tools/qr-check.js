// A self-check for lib.qr, the QR codes of shared playlists:  node tools/qr-check.js
// Each code below was checked once against an independent encoder (the qrcode package, module for module) and decoder
// (jsQR); this keeps them from changing by accident. A change on purpose: check again, then update the fingerprints.
const assert = require('assert');
const { qr } = require('../lib.js');
const print = m => require('crypto').createHash('sha256').update(m.map(r => r.map(Number).join('')).join('')).digest('hex').slice(0, 16);
for (const [text, version, fingerprint] of [
  ['NetherFlow', 1, '424baa7f4f13f536'],
  ['https://volodya-rua.github.io/NetherFlow/p/#' + 'Ab9-_'.repeat(55), 11, '85cbf13c30064192'],
  ['x'.repeat(2000), 33, '01a80e18923534db'],
  ['x'.repeat(2953), 40, '26ab6b9a9dce6209'],
]) {
  const m = qr(text);
  assert.strictEqual((m.length - 17) / 4, version, `version for ${text.length} characters`);
  assert.strictEqual(print(m), fingerprint, `modules for ${text.length} characters`);
}
assert.strictEqual(qr('x'.repeat(2954)), null, 'too long for one code');
console.log('lib.qr: ok');
