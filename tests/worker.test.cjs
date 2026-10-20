const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function worker({ neverReady = false, proxyHtml } = {}) {
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
    fetch() { return Promise.resolve(new Response(proxyHtml || '<html><head></head><body>external page</body></html>', { headers: { 'content-type': 'text/html' } })); }
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
  return { request: (route, destination = 'document') => context.handleRequest({ request: { url: 'https://site.test' + route, destination } }), loads: () => loads, blocked: context.isBlocked };
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
  assert.ok(source.includes('indexedDB.open("$scramjet",4)'));
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

test('Scramjet error HTML is replaced before returning to the iframe', async () => {
 const response = await worker({proxyHtml:'<html>Uh oh! There was an error loading https://private.test Scramjet Stack: transport</html>'}).request('/scramjet/test');
 const html = await response.text();
 assert.equal(response.status, 502);
 assert.match(html, /data-tros-proxy-error/);
 assert.doesNotMatch(html, /Uh oh|private.test|Stack:|Scramjet/);
});
test('ordinary upstream error wording is not mistaken for a proxy error', async () => {
 const response = await worker({proxyHtml:'<html><head></head><body>There was an error loading a picture</body></html>'}).request('/scramjet/test');
 assert.equal(response.status, 200);
 assert.match(await response.text(), /loading a picture/);
});

test('proxied Google searches use DuckDuckGo without requesting a CAPTCHA page', async () => {
 const app = worker({neverReady:true});
 for (const target of ['https://www.google.com/search?q=hello+world', 'https://www.google.se/sorry/index?continue='+encodeURIComponent('https://www.google.se/search?q=hello+world')]) {
  const response=await app.request('/scramjet/'+encodeURIComponent(target));
  assert.equal(response.status,302);
  assert.equal(decodeURIComponent(new URL(response.headers.get('location')).pathname.slice('/scramjet/'.length)),'https://duckduckgo.com/?q=hello%20world');
 }
 assert.equal(app.loads(),0);
});
test('Google verification without a query shows a choice without loading reCAPTCHA',async()=>{
 const response=await worker({neverReady:true}).request('/scramjet/'+encodeURIComponent('https://www.google.com/sorry/index'));
 const html=await response.text();
 assert.match(html,/Öppna DuckDuckGo/);
 assert.doesNotMatch(html,/recaptcha|<script/i);
});
test('unrelated Google pages and subresources are not redirected',async()=>{
 for(const [target,destination] of [['https://www.google.com/maps','document'],['https://www.google.com/recaptcha/api.js','script']]) {
  const response=await worker().request('/scramjet/'+encodeURIComponent(target),destination);
  assert.equal(response.status,200);
  assert.equal(response.headers.get('location'),null);
 }
});

test('browser address bar normalizes Google search links before opening a frame',()=>{
 const source=fs.readFileSync(require.resolve('../n1browseae24.js'),'utf8');
 const code=source.slice(source.indexOf('  function buildUrl(raw)'),source.indexOf('  let tabs ='));
 const context={URL};vm.createContext(context);vm.runInContext(code,context);
 assert.equal(context.buildUrl('https://www.google.com/search?q=hello+world'),'https://duckduckgo.com/?q=hello%20world');
 assert.equal(context.buildUrl('google.se'),'https://duckduckgo.com/');
 assert.equal(context.buildUrl('https://www.google.com/maps'),'https://www.google.com/maps');
 assert.equal(context.buildUrl('hello world'),'https://duckduckgo.com/?q=hello%20world');
});
