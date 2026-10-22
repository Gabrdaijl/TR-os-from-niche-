'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../snap-memory.js'), 'utf8');
function setup() {
  const sandbox = { Uint8Array, TypeError, btoa: value => Buffer.from(value, 'binary').toString('base64') };
  vm.runInNewContext(source, sandbox);
  return sandbox.TR_OS_SNAP_MEMORY;
}
test('chunked WASM base64 encoding matches the standard encoding across chunk boundaries', () => {
  const encode = setup().toBase64;
  for (const length of [0, 1, 32767, 32768, 32769, 586279]) {
    const bytes = Uint8Array.from({ length }, (_, index) => (index * 37 + 19) & 255);
    assert.equal(encode(bytes), Buffer.from(bytes).toString('base64'));
  }
});
test('WASM encoder rejects non-byte inputs', () => {
  assert.throws(() => setup().toBase64(new ArrayBuffer(1)), /Expected WASM bytes/);
});
test('Snapchat controller reuses one WASM fetch and calls the low-allocation encoder', () => {
  const html = fs.readFileSync(path.join(__dirname, '../snapchat.html'), 'utf8');
  const release = html.match(/data-snapchat-release="([^"]+)"/)[1];
  assert.match(html, new RegExp('snap-memory\\.js\\?v=' + release));
  const controller = fs.readFileSync(path.join(__dirname, '../snap-controller.api.js'), 'utf8');
  assert.ok(controller.includes('this.wasmBytes=new Uint8Array(await e.arrayBuffer())'));
  assert.ok(controller.includes('globalThis.TR_OS_SNAP_MEMORY.toBase64(this.wasmBytes)'));
  assert.doesNotMatch(controller, /new Uint8Array\\(t\\)\\.reduce/);
});