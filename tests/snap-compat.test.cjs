'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../snap-compat.js'), 'utf8');
const expectedHash = 'd68750cc94dde81cd3d6daabf39b913381b2ff4c4d3a5bc6aad8451edb2d2a4b';
const target = new URL('https://cf-st.sc-cdn.net/dw/127ca002fe3599f56576.js');
// Exact optional-effect expression in the pinned public Snapchat asset.
const effect = 'function effect(n){return navigator.serviceWorker.addEventListener("message",n),()=>navigator.serviceWorker.removeEventListener("message",n)}';
function setup({ wrongHash = false } = {}) {
  const window = {};
  vm.runInNewContext(source, { window, URL, Uint8Array, TextDecoder, TextEncoder, setTimeout, clearTimeout, Promise,
    crypto: { subtle: { digest: async () => Uint8Array.from(Buffer.from(wrongHash ? '0'.repeat(64) : expectedHash, 'hex')).buffer } } });
  return window.TR_OS_SNAP_COMPAT;
}
function response(body = effect) {
  return { status: 200, statusText: 'OK', body: new Response(body).body,
    headers: [['Content-Type', 'text/javascript'], ['Content-Length', 'old'], ['Content-Encoding', 'gzip'], ['ETag', 'old'], ['Digest', 'old'], ['Set-Cookie', 'SYNTHETIC_PRESERVED']] };
}
test('actual optional notification effect fails without SW; guarded version mounts and cleans up', async () => {
  const original = vm.runInNewContext('(' + effect + ')', { navigator: {} });
  assert.throws(() => original(() => {}), /addEventListener/);
  const fixed = await setup().response(response(), target);
  const text = await new Response(fixed.body).text();
  const guarded = vm.runInNewContext('(' + text + ')', { navigator: {} });
  const cleanup = guarded(() => {});
  assert.equal(cleanup(), undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(fixed.headers)), [['Content-Type', 'text/javascript'], ['Set-Cookie', 'SYNTHETIC_PRESERVED']]);
});
test('available notification API receives the same add/remove callback', async () => {
  const result = await setup().response(response(), target);
  const text = await new Response(result.body).text(), calls = [];
  const guarded = vm.runInNewContext('(' + text + ')', { navigator: { serviceWorker: {
    addEventListener: (...args) => calls.push(['add', ...args]), removeEventListener: (...args) => calls.push(['remove', ...args])
  } } });
  const callback = () => {}, cleanup = guarded(callback); cleanup();
  assert.deepEqual(calls, [['add', 'message', callback], ['remove', 'message', callback]]);
});
test('wrong asset, status or unsafe origin is untouched before any read', async () => {
  const compat = setup();
  for (const url of ['https://cf-st.sc-cdn.net/dw/other.js', 'https://other.invalid' + target.pathname, 'http://cf-st.sc-cdn.net' + target.pathname]) {
    const original = response(); assert.equal(await compat.response(original, new URL(url)), original);
  }
  const original = { ...response(), status: 403 };
  assert.equal(await compat.response(original, target), original);
});
test('hash mismatch and changed source expressions preserve every original byte and header', async () => {
  for (const [compat, body] of [[setup({ wrongHash: true }), effect], [setup(), effect + effect], [setup(), 'unrelated script']]) {
    const original = response(body), result = await compat.response(original, target);
    assert.equal(await new Response(result.body).text(), body);
    assert.equal(result.headers, original.headers);
  }
});
test('oversize copy does not consume or truncate the forwarded original', async () => {
  const bytes = new Uint8Array(12582913).fill(65), original = response(bytes);
  const result = await setup().response(original, target);
  assert.equal((await new Response(result.body).arrayBuffer()).byteLength, bytes.length);
  assert.equal(result.headers, original.headers);
});
