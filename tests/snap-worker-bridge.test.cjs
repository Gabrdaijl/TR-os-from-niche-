'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { MessageChannel, MessagePort } = require('node:worker_threads');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const engine = fs.readFileSync(path.join(root, 'snap-engine.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'snap-controller.api.js'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'snap-worker-bridge.js'), 'utf8');
const wasm = fs.readFileSync(path.join(root, 'snap-engine.wasm')).toString('base64');
const targets = new WeakMap();
// Native EventTarget backs the VM global, so propagation stopping is real.
class Target extends EventTarget {
  addEventListener(...args) {
    if (this instanceof EventTarget) return EventTarget.prototype.addEventListener.apply(this, args);
    if (!targets.has(this)) targets.set(this, new EventTarget());
    return targets.get(this).addEventListener(...args);
  }
  dispatchEvent(event) {
    if (this instanceof EventTarget) return EventTarget.prototype.dispatchEvent.call(this, event);
    if (!targets.has(this)) targets.set(this, new EventTarget());
    return targets.get(this).dispatchEvent(event);
  }
}
class NoNetworkSocket extends Target { static CLOSED = 3; static CONNECTING = 0; static OPEN = 1;
  constructor() { super(); throw new Error('Native network must not be used'); }
}
function runtime(location) {
  const context = vm.createContext({
    URL, URLSearchParams, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, WebAssembly,
    EventTarget: Target, Event, MessageEvent, Response, Request, Headers, ReadableStream, Blob,
    WebSocket: NoNetworkSocket, MessageChannel, MessagePort, crypto: webcrypto,
    WorkerGlobalScope: class {}, WorkerNavigator: class {}, WorkerLocation: URL,
    navigator: {}, location: new URL(location), console, performance, atob, btoa,
    setTimeout, clearTimeout, setInterval, clearInterval,
    fetch() { throw new Error('Native network must not be used'); },
    importScripts() {}, postMessage() {}
  });
  vm.runInContext('globalThis.self = globalThis; globalThis.deliver = function(data, ports = []) { EventTarget.prototype.dispatchEvent.call(globalThis, new MessageEvent("message", {data, ports})); };', context);
  vm.runInContext(engine, context, { filename: 'actual-snap-engine.js' });
  return context;
}
function decode(script) { return Buffer.from(script.split(',')[1], 'base64').toString('utf8'); }
function scriptsFrom(frame, kind) {
  const scripts = [];
  const capture = value => { scripts.push(value); return ''; };
  if (kind === 'worker') frame.context.interface.getWorkerInjectScripts({}, 'worker', capture);
  else frame.context.interface.getInjectScripts({}, {}, { headers: [], history: [] }, capture);
  return scripts;
}
function setup(t, { changedCookie = false, selectedProtocol = '' } = {}) {
  const host = runtime('https://tr-os.test/snapchat.html');
  vm.runInContext(api, host, { filename: 'actual-snap-controller.api.js' });
  vm.runInContext(bridge, host);
  const controller = host.$scramjetController;
  host.TR_OS_SNAP_WORKER.install(controller);
  const frame = Object.create(controller.Frame.prototype);
  frame.prefix = '/snap-fixture/owner/frame/';
  const jar = new host.$scramjet.CookieJar();
  jar.setCookies('session=synthetic-fixture; Path=/; Secure', new URL('https://www.snapchat.com/'));
  frame.controller = { config: { ...controller.config, scramjetPath: '/snap-engine.js' },
    scramjetConfig: { ...host.$scramjet.defaultConfig, flags: { ...host.$scramjet.defaultConfig.flags, allowFailedIntercepts: true } }, cookieJar: jar };
  const worker = runtime('https://tr-os.test/snap-fixture/owner/frame/https%3A%2F%2Fwww.snapchat.com%2Fworker.js');
  let client, activeWorker, pendingReady;
  const requests = [], connections = [], appWorkerMessages = [], appWindowMessages = [];
  worker.$scramjet.ScramjetClient.prototype.hook = function () { client = this; };
  worker.WASM = wasm;
  worker.postMessage = value => { pendingReady = value; };
  vm.runInContext(decode(scriptsFrom(frame, 'worker')[2]), worker);
  assert.ok(client);
  if (changedCookie) jar.setCookies('session=newer-fixture; Path=/; Secure', new URL('https://www.snapchat.com/'));
  class WorkerStub extends Target {
    constructor(_url, options) {
      super(); activeWorker = this;
      if (!options?.fixtureRaw) queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: pendingReady })));
    }
    postMessage(value, ports) { this.port = value.port; worker.deliver(value, ports); }
    terminate() { this.port?.close(); }
  }
  host.Worker = WorkerStub;
  host.navigator.serviceWorker = new Target();
  host[host.$scramjet.SCRAMJETCLIENT] = {
    context: { prefix: new URL(frame.prefix, host.location), cookieJar: jar },
    init: {
      transport: {
        async request(url, method, body, headers) { requests.push({ url: url.href, method, body, headers }); return { status: 200, statusText: 'OK', headers: [], body: new TextEncoder().encode('fixture').buffer }; },
        connect(url, protocols, headers, open, message, close) {
          connections.push({ url: url.href, protocols, headers }); queueMicrotask(() => open(selectedProtocol, ''));
          return [data => message(data), (code, reason) => close(code, reason)];
        }
      },
      async sendSetCookie(entries) { for (const entry of entries) jar.setCookies(entry.cookie, entry.url); }
    }
  };
  const windowScripts = scriptsFrom(frame, 'window');
  const relay = windowScripts.find(value => value.startsWith('data:') && decode(value).includes('function windowRelay'));
  assert.ok(relay);
  vm.runInContext(decode(relay), host);
  vm.runInContext('EventTarget.prototype.addEventListener.call(globalThis, "message", event => observedWorkerMessages.push(event.data));', Object.assign(worker, { observedWorkerMessages: appWorkerMessages }));
  const created = new host.Worker('blob:https://tr-os.test/controlled-rewritten-blob');
  created.addEventListener('message', event => appWindowMessages.push(event.data));
  t.after(() => created.terminate());
  return { host, worker, client, jar, requests, connections, appWorkerMessages, appWindowMessages, created, get activeWorker() { return activeWorker; } };
}

test('bridge install is idempotent and scoped to the supplied controller', () => {
  const host = runtime('https://tr-os.test/snapchat.html');
  vm.runInContext(api, host); vm.runInContext(bridge, host);
  const original = Object.getOwnPropertyDescriptor(host.$scramjetController.Frame.prototype, 'context').get;
  host.TR_OS_SNAP_WORKER.install(host.$scramjetController);
  const patched = Object.getOwnPropertyDescriptor(host.$scramjetController.Frame.prototype, 'context').get;
  host.TR_OS_SNAP_WORKER.install(host.$scramjetController);
  assert.notEqual(patched, original);
  assert.equal(Object.getOwnPropertyDescriptor(host.$scramjetController.Frame.prototype, 'context').get, patched);
});

test('actual generated worker gets owner cookies and real parent-mediated transport without worker SW', { timeout: 2000 }, async t => {
  const h = setup(t, { changedCookie: true });
  assert.equal(h.worker.navigator.serviceWorker, undefined);
  await h.client.bare.transport.init();
  assert.equal(h.client.context.cookieJar.getCookies(new URL('https://www.snapchat.com/'), false), 'session=newer-fixture');
  const response = await h.client.bare.transport.request(new URL('https://example.invalid/controlled'), 'GET', null, [['x-fixture', 'yes']]);
  assert.equal(response.status, 200);
  assert.equal(new TextDecoder().decode(response.body), 'fixture');
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, 'https://example.invalid/controlled');
});

test('WebSocket round trip preserves synthetic auth and consumes both control messages', { timeout: 2000 }, async t => {
  const h = setup(t);
  const transport = h.client.bare.transport;
  assert.equal(transport.ready, false);
  const cookie = h.client.context.cookieJar.getCookies(new URL('https://www.snapchat.com/'), false);
  let opened, echoed;
  const open = new Promise(resolve => { opened = resolve; });
  const echo = new Promise(resolve => { echoed = resolve; });
  const [send, close] = transport.connect(new URL('wss://www.snapchat.com/controlled'), ['fixture'], [['Cookie', cookie]], opened, echoed, () => {}, error => assert.fail(error));
  // The channel has not arrived yet: transport operations queue safely.
  send('tros-worker-check');
  await open;
  assert.equal(await echo, 'tros-worker-check');
  assert.deepEqual(Array.from(h.connections[0].headers, header => Array.from(header)), [['Cookie', 'session=synthetic-fixture']]);
  assert.equal(h.appWorkerMessages.length, 0, 'Application worker listener must never see cookie dump or port');
  assert.equal(h.appWindowMessages.length, 0, 'Application window listener must never see bridge ready control message');
  close(1000, 'done');
});

test('socket authentication uses current owner cookies even when worker snapshot was stale before handshake', { timeout: 2000 }, async t => {
  const h = setup(t, { changedCookie: true });
  const stale = h.client.context.cookieJar.getCookies(new URL('https://www.snapchat.com/'), false);
  assert.equal(stale, 'session=synthetic-fixture');
  const opened = new Promise((resolve, reject) => {
    h.client.bare.transport.connect(new URL('wss://www.snapchat.com/controlled'), [],
      [['cOoKiE', stale], ['Cookie', 'caller-forged'], ['x-fixture', 'preserved']], resolve, () => {}, () => {}, reject);
  });
  await opened;
  assert.deepEqual(Array.from(h.connections[0].headers, header => Array.from(header)), [['x-fixture', 'preserved'], ['Cookie', 'session=newer-fixture']]);
});

test('worker transport forwards the actual second protocol and binary data', { timeout: 2000 }, async t => {
  const h = setup(t, { selectedProtocol: 'second' });
  let opened, received;
  const open = new Promise(resolve => { opened = (...args) => resolve(args); });
  const message = new Promise(resolve => { received = resolve; });
  const [send, close] = h.client.bare.transport.connect(new URL('wss://www.snapchat.com/controlled'), ['first', 'second'], [], opened, received, () => {}, error => assert.fail(error));
  assert.deepEqual(await open, ['second', '']);
  send(Uint8Array.of(0, 128, 255));
  assert.deepEqual(Array.from(await message), [0, 128, 255]);
  close(1000, 'done');
});

test('socket cookie lookup follows target host and ws security semantics instead of caller header', { timeout: 2000 }, async t => {
  const h = setup(t);
  const connect = url => new Promise((resolve, reject) => {
    h.client.bare.transport.connect(new URL(url), [], [['Cookie', 'session=caller-forged']], resolve, () => {}, () => {}, reject);
  });
  await connect('wss://other.example.invalid/controlled');
  await connect('ws://www.snapchat.com/controlled');
  assert.equal(h.connections.length, 2);
  assert.equal(h.connections[0].headers.some(([name]) => name.toLowerCase() === 'cookie'), false, 'Do not send Snapchat auth to another host');
  assert.equal(h.connections[1].headers.some(([name]) => name.toLowerCase() === 'cookie'), false, 'Secure cookies must not go over ws');
});

test('raw worker receives no cookie channel until the generated bootstrap nonce is presented', { timeout: 2000 }, async t => {
  const h = setup(t); await h.client.bare.transport.init();
  const raw = new h.host.Worker('blob:https://tr-os.test/raw-worker', { fixtureRaw: true });
  raw.dispatchEvent(new MessageEvent('message', { data: { marker: 'wrong-frame', type: 'tros-worker-ready' } }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(raw.port, undefined);
  raw.terminate();
});

test('native SW cookie update reaches the owning worker and cookie writes return through owner', { timeout: 2000 }, async t => {
  const h = setup(t); await h.client.bare.transport.init();
  const updated = new Promise(resolve => {
    const timer = setInterval(() => {
      if (h.client.context.cookieJar.getCookies(new URL('https://www.snapchat.com/'), false).includes('refresh=fixture')) { clearInterval(timer); resolve(); }
    }, 5);
    t.after(() => clearInterval(timer));
  });
  h.host.navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { $controller$setCookie: {
    cookies: [{ url: 'https://www.snapchat.com/', cookie: 'refresh=fixture; Secure; Path=/' }], options: {}
  } } }));
  await updated;
  await h.client.bare.transport.sendSetCookie([{ url: new URL('https://www.snapchat.com/'), cookie: 'worker=fixture; Secure; Path=/' }]);
  assert.match(h.jar.getCookies(new URL('https://www.snapchat.com/'), false), /worker=fixture/);
});
