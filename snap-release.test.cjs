'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
test('normal Snapchat entry and every executable local asset share one release', () => {
  const html = fs.readFileSync(path.join(root, 'snapchat.html'), 'utf8');
  const release = html.match(/data-snapchat-release="([^"]+)"/)[1];
  const sources = [...html.matchAll(/<script src="([^"]+)"/g)].map(match => match[1]);
  assert.ok(sources.length > 7);
  for (const value of sources.filter(value => value !== 'tr-os.config.js')) {
    assert.equal(new URL(value, 'https://tr-os.test/').searchParams.get('v'), release, value);
  }
  const main = fs.readFileSync(path.join(root, 'snapchat.js'), 'utf8');
  assert.ok(main.includes("const release = '" + release + "'"));
  assert.ok(fs.readFileSync(path.join(root, 'snap-compat.js'), 'utf8').includes("const release = '" + release + "'"));
  assert.ok(fs.readFileSync(path.join(root, 'snap-report.js'), 'utf8').includes("const release = '" + release + "'"));
  assert.ok(fs.readFileSync(path.join(root, 'snap-call-diagnostics.js'), 'utf8').includes("const release = '" + release + "'"));
  assert.ok(fs.readFileSync(path.join(root, 'snap-lazy-curl.js'), 'utf8').includes("const release = '" + release + "'"));
  assert.ok(fs.readFileSync(path.join(root, 'n1browseae24.js'), 'utf8').includes("tab.frame.src = 'snapchat.html?v=" + release + "'"));
  assert.ok(fs.readFileSync(path.join(root, 'mobile.js'), 'utf8').includes("src: '/snapchat.html?v=" + release + "'"));
  for (const name of ['snap-curl-transport.js', 'snap-engine.js', 'snap-controller.inject.js', 'snap-engine.wasm']) {
    assert.ok(main.includes(name + "?v=' + release"), name + ' must use the same release for dynamic assets');
  }
  assert.match(html, /snap-call-diagnostics\.js\?v=/);
  assert.match(main, /TR_OS_SNAP_CALLS\.install\(frame, true/);
});

test('Snapchat help does not offer a direct Snapchat link or tell users to leave TR-os', () => {
  const html = fs.readFileSync(path.join(root, 'snapchat.html'), 'utf8');
  assert.doesNotMatch(html, /<a\b[^>]*href=["']https:\/\/(?:www\.)?snapchat\.com/i);
  assert.doesNotMatch(html, /open Snapchat as usual|öppna Snapchat direkt/i);
});
