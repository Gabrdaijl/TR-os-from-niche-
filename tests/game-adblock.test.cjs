const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('game filter blocks known ad requests and popups while preserving game fetches', async () => {
  const requests = [], xhrRequests = [];
  class Xhr { open(method, url) { xhrRequests.push(url); } }
  const context = {
    window: { fetch: async url => { requests.push(url); return new Response('game data'); }, open: () => { throw new Error('popup escaped'); } },
    document: { baseURI: 'https://games.test/game/', querySelectorAll: () => [], addEventListener() {} },
    XMLHttpRequest: Xhr, MutationObserver: class { observe() {} }, URL, Response
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('../game-adblock.js'), 'utf8'), context);
  assert.equal((await context.window.fetch('https://ads.doubleclick.net/banner')).status, 204);
  assert.equal(requests.length, 0);
  assert.equal(await (await context.window.fetch('https://cdn.games.test/game.wasm')).text(), 'game data');
  assert.equal(requests.length, 1);
  new Xhr().open('GET', 'https://popads.net/ad');
  assert.equal(xhrRequests[0], 'data:text/plain,');
  assert.equal(context.window.open('https://ads.test'), null);
});
