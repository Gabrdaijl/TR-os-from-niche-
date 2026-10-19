'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const curl = fs.readFileSync(path.join(root, 'snap-curl-transport.js'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'snap-engine.js'), 'utf8');

// Exercise the installed vendor class, replacing only its native WASM boundary.
function socket(offered = []) {
  class Session {
    set_connections() {}
    create_request(_url, _data, finish, headers) { this.finish = finish; this.headers = headers; return 1; }
    start_request() {}
    close() { this.removed = true; }
  }
  const code = curl.slice(curl.indexOf('  class CurlWebSocket extends CurlSession {'), curl.indexOf('  class FakeWebSocket extends EventTarget {'));
  const logs = [];
  const C = vm.runInNewContext(code + '\nCurlWebSocket', {
    CurlSession: Session, TextDecoder, check_proxy() {}, c_func() {}, _http_set_options() {},
    _websocket_set_options() {}, setInterval() { return 1; }, clearInterval() {},
    error_msg: value => logs.push(value), get_error_str: () => 'Controlled protocol rejection'
  });
  const s = new C('wss://fixture.invalid/socket?PRIVATE_QUERY', offered);
  let opens = 0, errors = 0;
  s.onopen = () => opens++;
  s.onerror = () => errors++;
  return { s, logs, send(value, split = false) {
    const bytes = new TextEncoder().encode(value);
    if (split) for (const byte of bytes) s.headers(Uint8Array.of(byte));
    else s.headers(bytes);
  }, finish() { s.finish(0); return { opens, errors }; } };
}
const response = protocol => 'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' + protocol + '\r\n';

test('Curl send conversion preserves only the selected bytes from an ArrayBufferView', () => {
  const start = curl.indexOf('  function data_to_array(');
  const end = curl.indexOf('  function c_func(', start);
  assert.ok(start >= 0 && end > start);
  const convert = vm.runInNewContext(curl.slice(start, end) + '\ndata_to_array', { Uint8Array, ArrayBuffer, TextEncoder });
  const backing = Uint8Array.of(91, 92, 0, 128, 255, 3, 93, 94);
  for (const view of [new DataView(backing.buffer, 2, 4),
    new Uint16Array(backing.buffer, 2, 2), new Int8Array(backing.buffer, 2, 4),
    backing.subarray(2, 6)]) {
    assert.deepEqual(Array.from(convert(view)), [0, 128, 255, 3]);
  }
  assert.deepEqual(Array.from(backing), [91, 92, 0, 128, 255, 3, 93, 94]);
});

test('actual Curl class keeps the server-selected SECOND protocol with fragmented headers', () => {
  const h = socket(['first', 'second']);
  h.send('HTTP/1.1 103 Early Hints\r\nSec-WebSocket-Protocol: ignored\r\n\r\n');
  h.send(response('sEc-WeBsOcKeT-pRoToCoL: second\r\n'), true);
  assert.deepEqual(h.finish(), { opens: 1, errors: 0 });
  assert.equal(h.s.selectedProtocol, 'second');
  assert.deepEqual(h.logs, []);
});

test('no protocol offer and no selection stays empty', () => {
  const h = socket(); h.send(response(''));
  assert.deepEqual(h.finish(), { opens: 1, errors: 0 });
  assert.equal(h.s.selectedProtocol, '');
});

for (const [name, offered, header] of [
  ['missing', ['first'], ''],
  ['unsolicited', [], 'Sec-WebSocket-Protocol: first\r\n'],
  ['unoffered', ['first'], 'Sec-WebSocket-Protocol: other\r\n'],
  ['case-sensitive mismatch', ['First'], 'Sec-WebSocket-Protocol: first\r\n'],
  ['multiple values', ['first', 'second'], 'Sec-WebSocket-Protocol: first, second\r\n'],
  ['duplicate fields', ['first'], 'Sec-WebSocket-Protocol: first\r\nSec-WebSocket-Protocol: first\r\n'],
  ['folded continuation', ['first', 'second'], 'Sec-WebSocket-Protocol: second\r\n , first\r\n'],
  ['malformed header line', [], 'invalid-header-line\r\n'],
  ['empty', ['first'], 'Sec-WebSocket-Protocol: \r\n'],
  ['malformed', ['first'], 'Sec-WebSocket-Protocol: "first"\r\n'],
  ['unsolicited extension', [], 'Sec-WebSocket-Extensions: permessage-deflate\r\n']
]) test('invalid selection fails without open: ' + name, () => {
  const h = socket(offered); h.send(response(header));
  assert.deepEqual(h.finish(), { opens: 0, errors: 1 });
  assert.equal(h.s.selectedProtocol, '');
  assert.equal(h.s.removed, true);
  assert.ok(h.logs.every(value => !value.includes('PRIVATE_QUERY') && !value.includes('fixture.invalid')));
});

test('incomplete or excessive handshake headers cannot open', () => {
  for (const value of ['HTTP/1.1 101 Switching Protocols\r\n', response('x-fixture: ' + 'x'.repeat(65536) + '\r\n')]) {
    const h = socket(); h.send(value);
    assert.deepEqual(h.finish(), { opens: 0, errors: 1 });
  }
});

test('Curl facade and transport forward actual selection, without first-offer fallback', () => {
  const fake = curl.slice(curl.indexOf('  class FakeWebSocket extends EventTarget {'), curl.indexOf('  class TLSSocket extends CurlSession {'));
  const C = vm.runInNewContext(fake + '\nFakeWebSocket', { EventTarget });
  const instance = Object.create(C.prototype);
  instance.protocols = ['first', 'second']; instance.socket = { selectedProtocol: '' };
  assert.equal(instance.protocol, '');
  instance.socket.selectedProtocol = 'second';
  assert.equal(instance.protocol, 'second');
  assert.match(curl, /onopen\(socket\.protocol, socket\.extensions\)/);
});

test('installed Scramjet hook sets protocol before property callback AND event listener', () => {
  // Node brands EventTarget through .constructor; the browser hook intentionally
  // changes that descriptor, so use a minimal DOM event target in this VM.
  class Target {
    listeners = new Map();
    addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(fn); }
    dispatchEvent(event) { for (const fn of this.listeners.get(event.type) || []) fn(event); }
  }
  const start = engine.indexOf('3342(e,t,r){'), end = engine.indexOf('},5639(e,t,r){', start);
  assert.ok(start >= 0 && end > start);
  const code = 'function(e,t,r){' + engine.slice(start + '3342(e,t,r){'.length, end) + '}';
  const moduleExports = {}, hooks = new Map(), traps = new Map();
  const underlying = new Target(); underlying.protocol = 'second'; underlying.extensions = '';
  function requireModule(id) {
    assert.equal(id, 5994);
    return { qm: WeakMap, xP: URL, Cu() {}, rF: (value, key) => Reflect.get(value, key) };
  }
  requireModule.r = () => {};
  requireModule.d = (target, getters) => { for (const [key, get] of Object.entries(getters)) Object.defineProperty(target, key, { get }); };
  vm.runInNewContext('(' + code + ')', { EventTarget: Target, Event, URL })({}, moduleExports, requireModule);
  moduleExports.default({
    Proxy: (name, hook) => hooks.set(name, hook), Trap: (name, hook) => traps.set(name, hook),
    url: new URL('https://fixture.invalid/'), context: { cookieJar: { getCookies: () => '' } },
    bare: { createWebSocket: () => underlying }
  }, { navigator: { userAgent: 'Fixture' } });
  let exposed;
  hooks.get('WebSocket').construct({ args: ['wss://fixture.invalid/socket', ['first', 'second']], fn: class {}, return: value => exposed = value });
  const protocol = () => traps.get('WebSocket.prototype.protocol').get({ this: exposed });
  assert.equal(protocol(), '');
  const observed = [];
  traps.get('WebSocket.prototype.onopen').set({ this: exposed }, () => observed.push(protocol()));
  exposed.addEventListener('open', () => observed.push(protocol()));
  underlying.dispatchEvent(new Event('open'));
  assert.deepEqual(observed, ['second', 'second']);
});

test('controller injection does not print protocol-bearing connection responses', () => {
  const inject = fs.readFileSync(path.join(root, 'snap-controller.inject.js'), 'utf8');
  assert.doesNotMatch(inject, /console\.log\(e\),"success"===e\.result/);
});
