'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('PWA installs into the mobile app shell', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.start_url, '/mobile.html?source=homescreen');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.theme_color, '#93c5fd');
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

test('mobile shell exposes the same core apps inside the TR-os frame', () => {
  const page = read('mobile.html');
  const controller = read('mobile.js');
  assert.match(page, /id="mobile-frame"[^>]+src="\/n1browser27d\.html"/);
  for (const app of ['home', 'games', 'movies', 'ai', 'snapchat']) {
    assert.match(page, new RegExp(`data-page="${app}"`));
    assert.match(controller, new RegExp(`${app}: \\{ title:`));
  }
  assert.match(controller, /src: '\/n1chetesting2\.html'/);
  assert.match(controller, /src: '\/nm\.html'/);
  assert.match(controller, /src: '\/nai\.html'/);
  assert.match(controller, /src: '\/snapchat\.html\?mobile=1'/);
  assert.doesNotMatch(page, /href="https?:\/\/(?:www\.)?snapchat\.com/);
});

test('mobile shell keeps install guidance and adapts the content apps for phone widths', () => {
  const controller = read('mobile.js');
  assert.match(controller, /beforeinstallprompt/);
  assert.match(controller, /Lägg till på hemskärmen/);
  assert.match(controller, /display-mode: standalone/);
  assert.match(read('n1chetesting2.html'), /columns: compactLayout \? 3 : 8/);
  assert.match(read('n1chetesting2.html'), /gamesPerPage: compactLayout \? 15 : 32/);
  assert.match(read('nm.html'), /@media \(max-width: 700px\)/);
  assert.match(read('nai.html'), /ai-mobile-open/);
});
