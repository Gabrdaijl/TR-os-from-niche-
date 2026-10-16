const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function worker({ neverReady = false } = {}) {
  let loads = 0, initialized = false;
  class ProxyWorker {
    constructor() { this.config = { prefix: '/scramjet/' }; }
    loadConfig() {
      if (this.config) return Promise.resolve();
      loads++;
      if (neverReady) return new Promise(() => {});
      this.config = { prefix: '/scramjet/' };
      initialized = true;
      return Promise.resolve();
    }
    route() { assert.ok(initialized, 'shared rewriter configuration must be initialized'); return true; }
    fetch() { return Promise.resolve(new Response('<html><head></head><body>external page</body></html>', { headers: { 'content-type': 'text/html' } })); }
    addEventListener() {}
  }
  const context = {
    navigator: { userAgent: '' }, importScripts() {},
    $scramjetLoadWorker: () => ({ ScramjetServiceWorker: ProxyWorker }),
    self: { location: { origin: 'https://site.test' }, registration: { scope: 'https://site.test/' }, addEventListener() {}, clients: { matchAll: () => Promise.resolve([]) } },
    URL, Response, Headers, TextEncoder,
    setTimeout: fn => setTimeout(fn, 30), clearTimeout,
    fetch: () => Promise.resolve(new Response('native app')),
    console: { error() {} }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('../sw.js'), 'utf8'), context);
  return { request: route => context.handleRequest({ request: { url: 'https://site.test' + route } }), loads: () => loads, blocked: context.isBlocked };
}
test('repeat visits bypass proxy initialization for app files', async () => {
  const app = worker({ neverReady: true });
  for (const route of ['/', '/index.html', '/n1browser27d.html', '/scram/scramjet.all.js', '/scram/scramjet.wasm.wasm', '/baremux/worker.js']) assert.equal(await (await app.request(route)).text(), 'native app');
  assert.equal(app.loads(), 0);
});
test('proxy requests initialize the shared configuration even after an early controller message', async () => {
  const app = worker();
  assert.equal((await app.request('/scramjet/test')).status, 200);
  assert.equal((await app.request('/scramjet/another')).status, 200);
  assert.equal(app.loads(), 1);
});
test('unresolved proxy configuration produces a bounded error instead of a blank page', async () => {
  const app = worker({ neverReady: true });
  assert.equal((await app.request('/scramjet/test')).status, 503);
});
test('controller and worker use the same database after repairing the mirrored library', () => {
  const source = fs.readFileSync(require.resolve('../scram/scramjet.all.js'), 'utf8');
  assert.ok(source.includes('indexedDB.open("$scramjet",1)'));
  assert.ok(!source.includes('indexedDB.open("%24scramjet.html"'));
});

test('mirrored Scramjet still enables the actual DOM, worker and shared hooks', () => {
 const source = fs.readFileSync(require.resolve('../scram/scramjet.all.js'), 'utf8');
 for (const group of ['dom', 'worker', 'shared']) {
  assert.ok(source.includes('r.startsWith("./' + group + '/")'));
  assert.ok(!source.includes(group + '/index.html'));
 }
});

test('proxy ad rules match domain suffixes and wildcard paths without blocking unrelated assets', () => {
 const app = worker();
 assert.equal(app.blocked('ads.doubleclick.net', '/banner.js'), true);
 assert.equal(app.blocked('doubleclick.net', '/banner.js'), true);
 assert.equal(app.blocked('game.test', '/ads/banner.js'), true);
 assert.equal(app.blocked('notdoubleclick.net', '/game.wasm'), false);
 assert.equal(app.blocked('cdn.game.test', '/assets/game.wasm'), false);
});
