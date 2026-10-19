'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('PWA installs into the dedicated mobile home view', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.start_url, '/mobile.html?source=homescreen');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some(icon => icon.src === '/logo.png' && icon.sizes === '430x430'));
  assert.match(read('mobile.html'), /rel="manifest" href="\/manifest\.webmanifest"/);
});

test('phone-sized desktop visits route to mobile view with a desktop escape hatch', () => {
  const home = read('index.html');
  assert.match(home, /matchMedia\('\(max-width: 760px\)'\)/);
  assert.match(home, /location\.replace\('\/mobile\.html' \+ location\.search \+ location\.hash\)/);
  assert.match(home, /get\('desktop'\) !== '1'/);
  assert.match(read('mobile.html'), /href="\/?\?desktop=1"/);
});

test('mobile home keeps Snapchat in the TR-os wrapper and supports install guidance', () => {
  const page = read('mobile.html');
  const controller = read('mobile.js');
  assert.match(page, /href="\/snapchat\.html\?mobile=1"/);
  assert.doesNotMatch(page, /href="https?:\/\/(?:www\.)?snapchat\.com/);
  assert.match(controller, /beforeinstallprompt/);
  assert.match(controller, /Lägg till på hemskärmen/);
  assert.match(controller, /display-mode: standalone/);
});
