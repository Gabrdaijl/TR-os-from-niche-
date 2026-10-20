'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../snap-worker-bridge.js'), 'utf8');
const start = source.indexOf('function installSnapImageEncodingFallback(scope) {');
const end = source.indexOf('\n  // Serialized into the proxied window', start);
assert.ok(start >= 0 && end > start, 'Snapchat JPEG fallback helper is present');
const install = vm.runInNewContext(`${source.slice(start, end)}\ninstallSnapImageEncodingFallback`, { Promise, Object });

test('retries a failed high-quality JPEG canvas export and preserves normal quality on success', async () => {
  const calls = [];
  class Canvas {
    toBlob(callback, type, quality) {
      calls.push([type, quality]);
      queueMicrotask(() => callback(quality === 0.95 ? null : { type, quality }));
    }
  }
  const page = { HTMLCanvasElement: Canvas };
  install(page);
  install(page);
  const result = await new Promise(resolve => new Canvas().toBlob(resolve, 'image/jpeg', 0.95));
  assert.deepEqual(calls, [['image/jpeg', 0.95], ['image/jpeg', 0.85]]);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { type: 'image/jpeg', quality: 0.85 });
});

test('does not alter PNG, lower-quality JPEG, or an already-successful JPEG export', async () => {
  const calls = [];
  class Canvas {
    toBlob(callback, type, quality) {
      calls.push([type, quality]);
      queueMicrotask(() => callback({ type, quality }));
    }
  }
  install({ HTMLCanvasElement: Canvas });
  const canvas = new Canvas();
  await new Promise(resolve => canvas.toBlob(resolve, 'image/png', 0.95));
  await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));
  assert.deepEqual(calls, [['image/png', 0.95], ['image/jpeg', 0.85], ['image/jpeg', 0.95]]);
});

test('retries an oversized JPEG when canvas uses the browser default quality', async () => {
  const qualities = [];
  class Canvas {
    toBlob(callback, type, quality) {
      qualities.push(quality === undefined ? 'default' : quality);
      queueMicrotask(() => callback({ type, size: quality === undefined ? 9 * 1024 * 1024 : 1024 }));
    }
  }
  install({ HTMLCanvasElement: Canvas });
  const result = await new Promise(resolve => new Canvas().toBlob(resolve, 'image/jpeg'));
  assert.deepEqual(qualities, ['default', 0.85]);
  assert.equal(result.size, 1024);
});

test('returns the original null result after bounded JPEG retries fail', async () => {
  const qualities = [];
  let callbacks = 0;
  class Canvas {
    toBlob(callback, _type, quality) {
      qualities.push(quality);
      queueMicrotask(() => callback(null));
    }
  }
  install({ HTMLCanvasElement: Canvas });
  const result = await new Promise(resolve => new Canvas().toBlob(blob => { callbacks++; resolve(blob); }, 'image/jpeg', 0.95));
  assert.equal(result, null);
  assert.equal(callbacks, 1);
  assert.deepEqual(qualities, [0.95, 0.85, 0.7, 0.55, 0.4, 0.25]);
});

test('retries rejected OffscreenCanvas JPEG conversions at lower quality', async () => {
  const qualities = [];
  class OffscreenCanvas {
    convertToBlob(options) {
      qualities.push(options.quality);
      return options.quality === 0.95 ? Promise.reject(new Error('encode failed')) : Promise.resolve({ type: options.type, quality: options.quality });
    }
  }
  install({ OffscreenCanvas });
  const result = await new OffscreenCanvas().convertToBlob({ type: 'image/jpeg', quality: 0.95, colorSpace: 'srgb' });
  assert.deepEqual(qualities, [0.95, 0.85]);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { type: 'image/jpeg', quality: 0.85 });
});

test('retries an oversized OffscreenCanvas JPEG when quality is omitted', async () => {
  const qualities = [];
  class OffscreenCanvas {
    async convertToBlob(options) {
      qualities.push(options.quality === undefined ? 'default' : options.quality);
      return { type: options.type, size: options.quality === undefined ? 9 * 1024 * 1024 : 1024 };
    }
  }
  install({ OffscreenCanvas });
  const result = await new OffscreenCanvas().convertToBlob({ type: 'image/jpeg' });
  assert.deepEqual(qualities, ['default', 0.85]);
  assert.equal(result.size, 1024);
});
