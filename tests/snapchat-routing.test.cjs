'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('Snapchat routing is isolated from the original proxy and normal app assets', async () => {
  const listeners = {};
  class LegacyWorker {
    constructor() { this.config = {}; }
    async loadConfig() { this.config = {}; }
    route(event) { return new URL(event.request.url).pathname.startsWith('/scramjet/'); }
    async fetch() { return new Response('legacy-proxy'); }
    addEventListener() {}
  }
  const sandbox = {
    URL, Response, Request, TextEncoder, TextDecoder, Uint8Array, console, setTimeout, clearTimeout,
    navigator: { userAgent: 'test' }, importScripts() {},
    fetch: async () => new Response('normal-asset'),
    $scramjetLoadWorker: () => ({ ScramjetServiceWorker: LegacyWorker }),
    $scramjetController: {
      shouldRoute: event => new URL(event.request.url).pathname.startsWith('/snap-proxy/'),
      route: async () => new Response('snapchat-proxy')
    },
    self: { location: { origin: 'https://tr-os.test' }, registration: { scope: 'https://tr-os.test/' },
      addEventListener: (type, callback) => { listeners[type] = callback; },
      clients: { claim() {}, async matchAll() { return []; } }, skipWaiting() {} }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'), sandbox);
  async function request(url) {
    let response;
    listeners.fetch({ request: new Request('https://tr-os.test' + url), respondWith(value) { response = value; } });
    return response ? (await response).text() : null;
  }
  assert.equal(await request('/snap-proxy/controller/frame/https%3A%2F%2Fweb.snapchat.com%2F'), 'snapchat-proxy');
  assert.equal(await request('/scramjet/https%3A%2F%2Fexample.com%2F'), 'legacy-proxy');
  assert.equal(await request('/'), null, 'home navigation stays with the native browser loader');
  assert.equal(await request('/index.html'), null);
  assert.equal(await request('/snap-engine.wasm'), null);
  assert.equal(await request('/api/health'), null);
});
