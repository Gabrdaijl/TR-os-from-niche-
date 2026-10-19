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
  assert.equal(manifest.theme_color, '#000000');
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

test('mobile shell keeps core apps and omits Snapchat from mobile navigation', () => {
  const page = read('mobile.html');
  const controller = read('mobile.js');
  assert.match(page, /id="mobile-frame"[^>]+src="\/n1browser27d\.html"/);
  for (const app of ['home', 'games', 'movies', 'ai']) {
    assert.match(page, new RegExp(`data-page="${app}"`));
    assert.match(controller, new RegExp(`${app}: \\{ title:`));
  }
  assert.match(controller, /src: '\/n1chetesting2\.html'/);
  assert.match(controller, /src: '\/nm\.html'/);
  assert.match(controller, /src: '\/nai\.html'/);
  assert.doesNotMatch(page, /Snapchat|snapchat/i);
  assert.doesNotMatch(controller, /snapchat/i);
  assert.doesNotMatch(page, /href="https?:\/\/(?:www\.)?snapchat\.com/);
});

test('mobile shell follows the saved app theme and expands Movies player to full view', () => {
  const shell = read('mobile.css');
  const controller = read('mobile.js');
  const movies = read('nm.js');
  const themeEngine = read('theme.black5ce31.js');
  assert.match(controller, /localStorage\.getItem\('tros-theme'\)/);
  assert.match(controller, /addEventListener\('storage'/);
  assert.match(controller, /trosThemeName/);
  assert.match(shell, /--bar-active/);
  assert.match(shell, /movie-player-open/);
  assert.match(read('nm.html'), /src="nm\.js\?v=20261019\.3"/);
  assert.match(movies, /trosMobilePlayer: open \? 'open' : 'close'/);
  assert.match(movies, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(themeEngine, /#tros-player-bar \{ background: linear-gradient\(180deg,\$\{CARD_BG\}/);
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
