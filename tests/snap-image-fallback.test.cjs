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

test('recovers a null JPEG result using a smaller copy without changing the original canvas', async () => {
  const draws = [];
  class Canvas {
    constructor(width = 2400, height = 1200) { this.width = width; this.height = height; }
    getContext() { return { drawImage: source => draws.push([source, this.width, this.height]) }; }
    toBlob(callback, type) {
      queueMicrotask(() => callback(this.width < 2400 ? { type, size: 1024 } : null));
    }
  }
  install({ HTMLCanvasElement: Canvas, document: { createElement: () => new Canvas(1, 1) } });
  const canvas = new Canvas();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));
  assert.equal(blob.type, 'image/jpeg');
  assert.equal(blob.size, 1024);
  assert.deepEqual([canvas.width, canvas.height], [2400, 1200]);
  assert.equal(draws[0][0], canvas);
  assert.equal(draws[0][1], 2048);
  assert.equal(draws[0][2], 1024);
});

test('bounded smaller copies fail once and native canvas security errors still throw', async () => {
  let copies = 0, callbacks = 0;
  class Canvas {
    constructor() { this.width = 640; this.height = 480; }
    getContext() { return { drawImage() {} }; }
    toBlob(callback) { queueMicrotask(() => callback(null)); }
  }
  install({ HTMLCanvasElement: Canvas, document: { createElement: () => { copies++; return new Canvas(); } } });
  const result = await new Promise(resolve => new Canvas().toBlob(blob => { callbacks++; resolve(blob); }, 'image/jpeg', 0.95));
  assert.equal(result, null);
  assert.equal(callbacks, 1);
  assert.equal(copies, 3);
  const securityError = Object.assign(new Error('Tainted canvas'), { name: 'SecurityError' });
  class TaintedCanvas { toBlob() { throw securityError; } }
  install({ HTMLCanvasElement: TaintedCanvas });
  assert.throws(() => new TaintedCanvas().toBlob(() => {}, 'image/jpeg', 0.95), error => error === securityError);
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
