'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const bridge = fs.readFileSync(path.join(root, 'snap-worker-bridge.js'), 'utf8');
const controller = fs.readFileSync(path.join(root, 'snap-controller.api.js'), 'utf8');
const start = bridge.indexOf('  async function fetchBlobFromOwningFrame(');
const nextSection = bridge.indexOf("// Snapchat's own capture scripts", start);
const end = bridge.lastIndexOf('\n', nextSection);
assert.ok(start >= 0 && end > start, 'the frame-scoped blob fetch helper is present');
const fetchBlobFromOwningFrame = vm.runInNewContext(`(${bridge.slice(start, end).trim()})`, { Promise });

test('Snapchat blob URLs are fetched in the frame that owns their origin', async () => {
  const owner = { fetch: async function (url) {
    assert.equal(this, owner);
    assert.equal(url, 'blob:https://www.snapchat.com/local-image');
    return { status: 200, body: 'frame blob' };
  } };
  let fallbackCalls = 0;
  const result = await fetchBlobFromOwningFrame({ contentWindow: owner },
    'blob:https://www.snapchat.com/local-image', async () => { fallbackCalls++; throw Error('wrong origin'); });
  assert.equal(result.body, 'frame blob');
  assert.equal(fallbackCalls, 0);
  assert.match(controller, /fetchBlobFromOwningFrame\(this\.element,e,fetch\)/,
    'the controller uses the owning frame for blob fetches');
});

test('parent fetch remains a fallback when there is no owning frame', async () => {
  const result = await fetchBlobFromOwningFrame(null, 'blob:https://tr-os.test/local', async url => ({ url }));
  assert.equal(result.url, 'blob:https://tr-os.test/local');
});

test('owner fetch failure falls back for parent-owned blobs and preserves the owner error otherwise', async () => {
  const ownerError = new TypeError('wrong-origin blob');
  const frame = { contentWindow: { fetch: async () => { throw ownerError; } } };
  const recovered = await fetchBlobFromOwningFrame(frame, 'blob:https://tr-os.test/local', async () => ({ ok: true }));
  assert.deepEqual(JSON.parse(JSON.stringify(recovered)), { ok: true });
  await assert.rejects(fetchBlobFromOwningFrame(frame, 'blob:https://www.snapchat.com/local', async () => {
    throw new TypeError('parent origin mismatch');
  }), error => error === ownerError);
});
