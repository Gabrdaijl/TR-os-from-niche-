'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('mobile home avoids duplicate proxy runtimes until an external page is opened', () => {
  const browser = read('n1browser27d.html');
  const home = read('n1chtesting1.html');
  const controller = read('n1browseae24.js');

  for (const html of [browser, home]) {
    assert.doesNotMatch(html, /<script[^>]+src=["'](?:baremux\/index\.js|scram\/scramjet\.all\.js)/i);
    assert.doesNotMatch(html, /<link[^>]+(?:modulepreload|preload)[^>]+(?:epoxy\/index\.mjs|scram\/scramjet\.all\.js)/i);
  }
  assert.match(controller, /await loadScript\(window\.TR_OS\.assetUrl\('baremux\/index\.js'\)\)/);
  assert.match(controller, /await loadScript\(window\.TR_OS\.assetUrl\('scram\/scramjet\.all\.js'\)\)/);
  assert.match(controller, /if \(!__sjReady\) \{[\s\S]*?initScramjet\(\);\s*return;/);
});

test('home search field fits narrow phone viewports and avoids mobile input zoom', () => {
  const home = read('n1chtesting1.html');
  assert.match(home, /width:min\(550px,calc\(100vw - 32px\)\)/);
  assert.match(home, /#home-search[^}]*font-size:16px/);
  assert.doesNotMatch(home, /w-\[350px\]|focus:w-\[550px\]/);
});
