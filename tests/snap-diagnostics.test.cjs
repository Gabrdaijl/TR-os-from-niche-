'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../snap-diagnostics.js'), 'utf8');
function setup() {
  const window = {}, reports = [];
  vm.runInNewContext(source, { window, URL, location: new URL('https://tr-os.test/snapchat.html'),
    TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, Promise, Number });
  return { reports, observe: body => window.TR_OS_SNAP_DIAGNOSTICS.observe(body, value => reports.push(value)) };
}
function envelope({ type = 'TypeError', frames = [], item = 'event' } = {}) {
  return JSON.stringify({ dsn: 'PRIVATE_DSN' }) + '\n' + JSON.stringify({ type: item }) + '\n' + JSON.stringify({
    exception: { values: [{ type, value: 'PRIVATE_MESSAGE', stacktrace: { frames } }] },
    user: { email: 'PRIVATE_EMAIL' }, contexts: { private: 'PRIVATE_SESSION' }, request: { url: 'https://private.invalid/?token=PRIVATE_TOKEN' }
  });
}
const valid = { filename: 'https://cf-st.sc-cdn.net/dw/127ca002fe3599f56576.js?token=PRIVATE_QUERY', lineno: 20, colno: 500, function: 'PRIVATE_FUNCTION' };

test('crash summary exposes only enum type and hashed public asset location', () => {
  const h = setup(), body = envelope({ frames: [valid] });
  assert.equal(h.observe(body), body);
  assert.deepEqual(JSON.parse(JSON.stringify(h.reports)), [{ type: 'TypeError', category: 'unknown', frames: [{ asset: 'https://cf-st.sc-cdn.net/dw/127ca002fe3599f56576.js', line: 20, column: 500 }] }]);
  assert.doesNotMatch(JSON.stringify(h.reports), /PRIVATE/);
});
test('custom types, private hosts/paths, userinfo, ports and malformed positions are excluded', () => {
  const h = setup();
  const frames = [
    { ...valid, filename: 'https://private.invalid/static/main-12345678.js' },
    { ...valid, filename: 'https://www.snapchat.com/accounts/PRIVATE/main-12345678.js' },
    { ...valid, filename: 'https://PRIVATE@www.snapchat.com/static/main-12345678.js' },
    { ...valid, filename: 'https://www.snapchat.com:444/static/main-12345678.js' },
    { ...valid, filename: 'https://www.snapchat.com/static/private.js' },
    { ...valid, filename: 'https://www.snapchat.com/static/PRIVATE_NAME/main-12345678.js' },
    { ...valid, filename: 'https://cf-st.sc-cdn.net/dw/PRIVATE_NAME/127ca002fe3599f56576.js' },
    { ...valid, lineno: 'PRIVATE' }, { ...valid, colno: -1 }
  ];
  h.observe(envelope({ type: 'PRIVATE_TYPE', frames }));
  assert.deepEqual(JSON.parse(JSON.stringify(h.reports)), [{ type: 'Other', category: 'unknown', frames: [] }]);
});
test('proxy frame filename resolves only to approved public asset and drops all query data', () => {
  const h = setup();
  h.observe(envelope({ frames: [{ ...valid, filename: 'https://tr-os.test/snap-proxy/fixture/frame/' + encodeURIComponent(valid.filename) }] }));
  assert.equal(h.reports[0].frames[0].asset, 'https://cf-st.sc-cdn.net/dw/127ca002fe3599f56576.js');
});
test('transactions, attachments, invalid JSON and oversized bodies have no report', () => {
  const h = setup();
  for (const body of [envelope({ item: 'transaction' }), envelope({ item: 'attachment' }), 'invalid', 'x'.repeat(262145)]) assert.equal(h.observe(body), body);
  assert.equal(h.reports.length, 0);
});
test('error categorization returns only fixed labels and never the exception value', () => {
  const h = setup();
  const body = envelope({ type: 'DataCloneError' }).replace('PRIVATE_MESSAGE', 'PRIVATE_ACCOUNT could not be cloned PRIVATE_TOKEN');
  h.observe(body);
  assert.equal(h.reports[0].type, 'DataCloneError');
  assert.equal(h.reports[0].category, 'structured-clone');
  assert.doesNotMatch(JSON.stringify(h.reports), /PRIVATE|could not be cloned/);
});
test('original standard exception is preferred to a synthetic React component stack', () => {
  const h = setup();
  const body = '{}\n{"type":"event"}\n' + JSON.stringify({ exception: { values: [
    { type: 'React ErrorBoundary TypeError', value: 'PRIVATE_SYNTHETIC', stacktrace: { frames: [valid] } },
    { type: 'TypeError', value: 'Cannot read properties of undefined PRIVATE_TOKEN', stacktrace: { frames: [] } }
  ] } });
  h.observe(body);
  assert.deepEqual(JSON.parse(JSON.stringify(h.reports)), [{ type: 'TypeError', category: 'null-property', frames: [] }]);
  assert.doesNotMatch(JSON.stringify(h.reports), /PRIVATE/);
});
test('stream tee forwards the exact bytes while reporting only the safe summary', async () => {
  const h = setup(), bytes = new TextEncoder().encode(envelope({ frames: [valid] }));
  const original = new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, 41)); c.enqueue(bytes.slice(41)); c.close(); } });
  const forwarded = h.observe(original);
  assert.notEqual(forwarded, original);
  assert.deepEqual(new Uint8Array(await new Response(forwarded).arrayBuffer()), bytes);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.reports.length, 1);
  assert.doesNotMatch(JSON.stringify(h.reports), /PRIVATE/);
});
test('oversized copy cancels only its own branch and original request still completes', async () => {
  const h = setup(), bytes = new Uint8Array(262145).fill(65);
  const original = new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });
  const output = new Uint8Array(await new Response(h.observe(original)).arrayBuffer());
  assert.deepEqual(output, bytes);
  assert.equal(h.reports.length, 0);
});
