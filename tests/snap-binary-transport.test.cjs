'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../snap-curl-transport.js'), 'utf8');

function vendorFunction(name, nextName, globals = {}) {
  const start = source.indexOf('  function ' + name + '(');
  const end = source.indexOf('  function ' + nextName + '(', start);
  assert.ok(start >= 0 && end > start);
  return vm.runInNewContext(source.slice(start, end) + '\n' + name,
    { Uint8Array, ArrayBuffer, TextEncoder, ...globals });
}

test('installed Curl conversion sends exactly the bytes of every BufferSource view', () => {
  const convert = vendorFunction('data_to_array', 'c_func');
  const backing = Uint8Array.of(91, 92, 0, 128, 255, 3, 93, 94);
  for (const view of [new DataView(backing.buffer, 2, 4),
    new Uint16Array(backing.buffer, 2, 2), new Int8Array(backing.buffer, 2, 4),
    backing.subarray(2, 6)]) {
    assert.deepEqual(Array.from(convert(view)), [0, 128, 255, 3]);
  }
  assert.deepEqual(Array.from(backing), [91, 92, 0, 128, 255, 3, 93, 94], 'Do not modify caller storage');
  assert.deepEqual(Array.from(convert(backing.buffer)), Array.from(backing));
  assert.deepEqual(Array.from(convert('å')), [195, 165]);
});

// Run the installed CurlWebSocket class with a controlled native recv boundary.
// Frame payloads and bytesleft come from libcurl; no network or account is used.
function receiver(chunks) {
  class Session { close() {} }
  let current, freed = 0;
  const memory = new Uint8Array(65536);
  const merge = arrays => {
    const joined = new Uint8Array(arrays.reduce((size, part) => size + part.length, 0));
    let offset = 0;
    for (const part of arrays) { joined.set(part, offset); offset += part.length; }
    return joined;
  };
  const start = source.indexOf('  class CurlWebSocket extends CurlSession {');
  const end = source.indexOf('  class FakeWebSocket extends EventTarget {', start);
  const C = vm.runInNewContext(source.slice(start, end) + '\nCurlWebSocket', {
    CurlSession: Session, Uint8Array, TextDecoder, Module: { HEAPU8: memory }, merge_arrays: merge,
    _recv_from_websocket(_handle, size) {
      assert.equal(size, 65536);
      current = chunks.shift() || { code: 81, data: new Uint8Array() };
      memory.set(current.data);
      return 1;
    },
    _get_result_buffer: () => 0,
    _get_result_code: () => current.code || 0,
    _get_result_closed: () => false,
    _get_result_size: () => current.data.length,
    _get_result_bytes_left: () => current.left || 0,
    _get_result_is_text: () => !!current.text,
    _free() { freed++; }
  });
  const socket = Object.create(C.prototype);
  socket.http_handle = 1;
  socket.recv_buffer = [];
  return { socket, get freed() { return freed; } };
}

test('exactly 64 KiB binary frame is delivered immediately and kept separate from next message', () => {
  const first = new Uint8Array(65536).fill(128);
  const second = Uint8Array.of(0, 255);
  const h = receiver([{ data: first }, { data: second }]);
  const received = h.socket.recv();
  assert.ok(received, 'A complete buffer-sized frame must be delivered without another message');
  assert.equal(received.length, first.length);
  assert.ok(received.every(byte => byte === 128));
  assert.deepEqual(h.socket.recv(), second);
  assert.equal(h.socket.recv(), null);
  assert.equal(h.freed, 6, 'Release both native buffers after every recv attempt');
});

test('full-size final chunk finishes a multi-chunk frame; CURLE_AGAIN keeps the partial bytes', () => {
  const head = Uint8Array.of(1, 2, 3);
  const tail = new Uint8Array(65536).fill(7);
  const h = receiver([{ data: head, left: 65536 }, { data: new Uint8Array(), code: 81 }, { data: tail }]);
  assert.equal(h.socket.recv(), null);
  assert.equal(h.socket.recv(), null);
  const received = h.socket.recv();
  assert.ok(received, 'The final full-size chunk must complete the frame');
  assert.equal(received.length, head.length + tail.length);
  assert.deepEqual(Array.from(received.subarray(0, 3)), [1, 2, 3]);
  assert.ok(received.subarray(3).every(byte => byte === 7));
  assert.equal(h.socket.recv_buffer.length, 0);
});

test('Blob WebSocket sends stay in order ahead of later text and binary messages', async () => {
  class FixtureBlob {
    constructor() { this.resolve = null; }
    arrayBuffer() { return new Promise(resolve => { this.resolve = resolve; }); }
  }
  class CurlSocket {
    constructor() { this.sent = []; this.selectedProtocol = ''; }
    send(data) { this.sent.push(data); }
    close() {}
  }
  class FixtureCloseEvent extends Event {}
  const start = source.indexOf('  class FakeWebSocket extends EventTarget {');
  const end = source.indexOf('  class TLSSocket extends CurlSession {', start);
  assert.ok(start >= 0 && end > start);
  const C = vm.runInNewContext(source.slice(start, end) + '\nFakeWebSocket', {
    EventTarget, Event, CloseEvent: FixtureCloseEvent, MessageEvent, DOMException, Uint8Array, ArrayBuffer,
    TextEncoder, Blob: FixtureBlob, CurlWebSocket: CurlSocket,
    data_to_array: vendorFunction('data_to_array', 'c_func')
  });
  const socket = new C('wss://fixture.invalid/socket');
  socket.socket.onopen();
  const image = new FixtureBlob();
  socket.send(image);
  socket.send('following control message');
  socket.send(Uint8Array.of(4, 5));
  assert.equal(socket.socket.sent.length, 0, 'Later messages wait while Blob bytes are read');
  image.resolve(Uint8Array.of(1, 2, 3).buffer);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(socket.socket.sent[0], Uint8Array.of(1, 2, 3));
  assert.equal(socket.socket.sent[1], 'following control message');
  assert.deepEqual(socket.socket.sent[2], Uint8Array.of(4, 5));
});
