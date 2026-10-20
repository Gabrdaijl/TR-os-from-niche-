const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('popup guard also blocks open calls from same-origin parent windows', () => {
  const top = makeWindow(null);
  top.parent = top;
  const parent = makeWindow(top);
  const child = makeWindow(parent);
  const context = {
    window: child,
    document: child.document,
    XMLHttpRequest: class { open() {} },
    MutationObserver: class { observe() {} },
    URL,
    Response
  };

  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('../frame-controls.js'), 'utf8'), context);

  assert.equal(child.open('https://ads.example'), null);
  assert.equal(parent.open('https://ads.example'), null);
  assert.equal(top.open('https://ads.example'), null);
});

function makeWindow(parent) {
  const document = {
    baseURI: 'https://tr-os.me/',
    documentElement: {},
    querySelectorAll: () => [],
    addEventListener() {}
  };
  return {
    parent,
    document,
    fetch: async () => new Response('ok'),
    open() { throw new Error('popup escaped'); }
  };
}
