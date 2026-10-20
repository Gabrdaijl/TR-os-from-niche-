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

test('movie shell can initialize Scramjet before the popup guard locks window.open', () => {
  const top = makeWindow(null);
  top.parent = top;
  const child = makeWindow(top);
  child.document.currentScript = { dataset: { trosDeferPopupGuard: '1' } };
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

  assert.throws(() => child.open('https://example.test'), /popup escaped/);
  child.__TR_OS_POPUP_GUARD__.installPopups();
  assert.equal(child.open('https://example.test'), null);
  assert.equal(top.open('https://example.test'), null);
});

test('a proxied player cannot see or remove the sandbox that blocks popups', () => {
  const top = makeWindow(null);
  top.parent = top;
  const parent = makeWindow(top);
  const frameAttributes = new Map([['sandbox', 'allow-scripts allow-same-origin allow-forms allow-presentation']]);
  const attributes = {
    getNamedItem(name) { return frameAttributes.has(name) ? { name, value: frameAttributes.get(name) } : null; },
    getNamedItemNS(_namespace, name) { return this.getNamedItem(name); },
    removeNamedItem(name) { frameAttributes.delete(name); },
    removeNamedItemNS(_namespace, name) { frameAttributes.delete(name); },
    setNamedItem(attribute) { frameAttributes.set(attribute.name, attribute.value); return attribute; },
    item(index) { return Array.from(frameAttributes, ([name, value]) => ({ name, value }))[index] || null; },
    [Symbol.iterator]: function* () { for (const [name, value] of frameAttributes) yield { name, value }; }
  };
  const frame = {
    attributes,
    sandbox: { length: 4, value: frameAttributes.get('sandbox') },
    hasAttribute(name) { return frameAttributes.has(name); },
    getAttribute(name) { return frameAttributes.get(name) ?? null; },
    getAttributeNames() { return Array.from(frameAttributes.keys()); },
    removeAttribute(name) { frameAttributes.delete(name); },
    setAttribute(name, value) { frameAttributes.set(name, value); },
    toggleAttribute(name) { frameAttributes.delete(name); return false; },
    removeAttributeNS(_namespace, name) { frameAttributes.delete(name); },
    cloneNode() { return { removeAttribute() {}, outerHTML: '<iframe></iframe>' }; }
  };
  const child = makeWindow(parent);
  child.frameElement = frame;
  child.document.currentScript = { dataset: { trosProxyEarly: '1' } };
  let readyHandler;
  child.document.addEventListener = (type, handler) => { if (type === 'DOMContentLoaded') readyHandler = handler; };
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

  assert.equal(frame.hasAttribute('sandbox'), false);
  assert.equal(frame.getAttribute('sandbox'), null);
  assert.equal(frame.sandbox.length, 0);
  assert.equal(frame.attributes.getNamedItem('sandbox'), null);
  frame.removeAttribute('sandbox');
  assert.equal(frameAttributes.has('sandbox'), true);
  assert.throws(() => child.open('https://ads.example'), /popup escaped/);
  readyHandler();
  assert.equal(child.open('https://ads.example'), null);
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
