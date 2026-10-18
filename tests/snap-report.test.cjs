'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../snap-report.js'), 'utf8');
function setup(enabled, options = {}) {
  const elements = new Map(['support-output', 'support-toggle', 'support-panel', 'support-close', 'support-intro', 'support-active', 'support-start', 'support-copy', 'support-result'].map(id => [id, {
    hidden: true, value: '', textContent: '', setAttribute(name, value) { this[name] = value; }, focus() {}, select() {}
  }]));
  const copies = [], navigations = [], window = {};
  vm.runInNewContext(source, { window, URL, Number, ReadableStream, WebAssembly, Worker: function () {},
    crypto: options.noCrypto ? undefined : require('node:crypto').webcrypto,
    navigator: { userAgent: 'Mozilla/5.0 (X11; CrOS PRIVATE_BOARD 99999) Chrome/126.0.0.0 PRIVATE_UA',
      clipboard: { async writeText(value) { if (options.copyError) throw new Error('PRIVATE_ERROR'); copies.push(value); } } },
    document: { getElementById: id => elements.get(id) },
    location: { href: 'https://tr-os.test/snapchat.html?v=20261018.3', replace: value => navigations.push(value) }
  });
  const report = window.TR_OS_SNAP_REPORT.create(enabled, true);
  return { report, elements, copies, navigations,
    state: () => JSON.parse(elements.get('support-output').value.split('\n').slice(1).join('\n')) };
}
test('ordinary help starts opt-in diagnostics in the same wrapper and never navigates away', () => {
  const h = setup(false);
  h.report.stage('engine'); h.report.compatibility('applied'); h.report.crash({ type: 'TypeError', category: 'null-property' });
  assert.equal(h.state().stage, 'starting'); assert.equal(h.state().compatibility, 'not-observed'); assert.deepEqual(h.state().crashes, []);
  assert.equal(h.elements.get('support-toggle').textContent, 'Hjälp');
  h.elements.get('support-toggle').onclick(); assert.equal(h.elements.get('support-panel').hidden, false);
  h.elements.get('support-start').onclick();
  assert.deepEqual(h.navigations, ['https://tr-os.test/snapchat.html?v=20261018.3&diagnostics=1']);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.cookie|fetch\(|XMLHttpRequest|postMessage|contentWindow/);
});
test('report accepts only fixed outcomes and public hashed assets; all query and user details are dropped', async () => {
  const h = setup(true);
  h.report.stage('page-loaded'); h.report.stage('PRIVATE_STAGE');
  h.report.compatibility('applied'); h.report.compatibility('PRIVATE_OUTCOME');
  h.report.socket('open'); h.report.socket('PRIVATE_SOCKET');
  h.report.asset('https://cf-st.sc-cdn.net/dw/127ca002fe3599f56576.js?PRIVATE_QUERY', 200);
  for (const value of ['https://private.invalid/dw/127ca002fe3599f56576.js', 'https://PRIVATE@cf-st.sc-cdn.net/dw/127ca002fe3599f56576.js', 'https://cf-st.sc-cdn.net:444/dw/127ca002fe3599f56576.js', 'https://cf-st.sc-cdn.net/dw/PRIVATE.js']) h.report.asset(value, 200);
  h.report.crash({ type: 'TypeError', category: 'null-property', message: 'PRIVATE_MESSAGE', user: 'PRIVATE_USER', frames: [
    { asset: 'https://cf-st.sc-cdn.net/dw/127ca002fe3599f56576.js?PRIVATE_QUERY', line: 1, column: 123, function: 'PRIVATE_FUNCTION' },
    { asset: 'https://private.invalid/dw/127ca002fe3599f56576.js', line: 1, column: 123 }
  ] });
  h.report.crash({ type: 'PRIVATE_ERROR', category: 'unknown' });
  await h.elements.get('support-copy').onclick();
  assert.equal(h.copies.length, 1); assert.doesNotMatch(h.copies[0], /PRIVATE/);
  assert.equal(h.state().stage, 'page-loaded'); assert.equal(h.state().socket, 'open'); assert.equal(h.state().scripts.length, 1);
  assert.deepEqual(h.state().browser, { family: 'Chrome', major: 126, platform: 'ChromeOS' });
  assert.equal(h.state().crashes[0].frames.length, 1); assert.equal(h.state().crashes.length, 1);
});
test('report is bounded, clipboard failure leaves a selectable local report and missing crypto does not crash startup', async () => {
  const h = setup(true, { noCrypto: true, copyError: true });
  for (let i = 1; i < 35; i++) {
    h.report.asset('https://cf-st.sc-cdn.net/dw/' + i.toString(16).padStart(20, '0') + '.js', 200);
    h.report.crash({ type: 'TypeError', category: 'unknown', frames: [] });
  }
  assert.equal(h.state().scripts.length, 16); assert.equal(h.state().crashes.length, 3);
  assert.equal(h.state().capabilities.digest, false);
  await h.elements.get('support-copy').onclick();
  assert.match(h.elements.get('support-result').textContent, /Ctrl\+C/);
});
