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
function setup({ wrongHash = false, clock, code = source } = {}) {
  const window = {};
  vm.runInNewContext(code, { window, URL, Uint8Array, TextDecoder, TextEncoder, setTimeout: clock?.setTimeout || setTimeout, clearTimeout: clock?.clearTimeout || clearTimeout, Promise,
    crypto: { subtle: { digest: async () => Uint8Array.from(Buffer.from(wrongHash ? '0'.repeat(64) : expectedHash, 'hex')).buffer } } });
  return window.TR_OS_SNAP_COMPAT;
}
function clock() {
  let now = 0, next = 0;
  const timers = new Map();
  return {
    setTimeout(fn, ms) { const id = ++next; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    advance(ms) {
      const end = now + ms;
      while (true) {
        const item = [...timers].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!item) break;
        now = item[1].at; timers.delete(item[0]); item[1].fn();
      }
      now = end;
    },
    get pending() { return timers.size; }
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
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

test('healthy progressive download may take 20 seconds without losing the guard', async () => {
  const time = clock(), outcomes = [], bytes = new TextEncoder().encode(effect);
  let input;
  const original = { ...response(), body: new ReadableStream({ start(c) { input = c; } }) };
  const pending = setup({ clock: time }).response(original, target, value => outcomes.push(value));
  for (let part = 0; part < 5; part++) {
    time.advance(4000);
    input.enqueue(bytes.slice(Math.floor(part * bytes.length / 5), Math.floor((part + 1) * bytes.length / 5)));
    await settle();
  }
  input.close();
  const result = await pending, body = await new Response(result.body).text();
  assert.match(body, /serviceWorker\?\.addEventListener/);
  assert.deepEqual(outcomes, ['applied']);
  assert.equal(time.pending, 0);
});

test('idle deadline returns intact original stream, cancels only the diagnostic copy and cleans timers', async () => {
  const time = clock(), outcomes = [];
  let input;
  const original = { ...response(), body: new ReadableStream({ start(c) { input = c; } }) };
  const pending = setup({ clock: time }).response(original, target, value => outcomes.push(value));
  time.advance(15000); await settle();
  const result = await pending;
  input.enqueue(new TextEncoder().encode(effect)); input.close();
  assert.equal(await new Response(result.body).text(), effect);
  assert.equal(result.headers, original.headers);
  assert.deepEqual(outcomes, ['idle-timeout']);
  assert.equal(time.pending, 0);
});

test('active progress remains bounded by the two minute total deadline', async () => {
  const time = clock(), outcomes = [], bytes = new TextEncoder().encode(effect);
  let input;
  const original = { ...response(), body: new ReadableStream({ start(c) { input = c; } }) };
  const pending = setup({ clock: time }).response(original, target, value => outcomes.push(value));
  for (let index = 0; index < 29; index++) { time.advance(4000); input.enqueue(bytes.slice(index, index + 1)); await settle(); }
  time.advance(4000); await settle();
  const result = await pending;
  input.enqueue(bytes.slice(29)); input.close();
  assert.equal(await new Response(result.body).text(), effect);
  assert.deepEqual(outcomes, ['total-timeout']);
  assert.equal(time.pending, 0);
});

test('fixed outcomes never contain input or errors and callback failure cannot break forwarding', async () => {
  const outcomes = [], original = response(effect + ' // PRIVATE_BODY');
  const result = await setup({ wrongHash: true }).response(original, target, value => outcomes.push(value));
  assert.deepEqual(outcomes, ['hash-mismatch']);
  assert.equal(await new Response(result.body).text(), effect + ' // PRIVATE_BODY');
  const fixed = await setup().response(response(), target, () => { throw Error('PRIVATE_CALLBACK'); });
  assert.match(await new Response(fixed.body).text(), /serviceWorker\?\./);
});
