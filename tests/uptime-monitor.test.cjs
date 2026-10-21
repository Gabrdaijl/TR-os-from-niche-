'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function jsonResponse(status, value) {
  return { ok: status >= 200 && status < 300, status, json: async () => value };
}

test('independent monitor opens one GitHub outage alert when the health endpoint fails', async t => {
  const oldFetch = global.fetch, oldRepo = process.env.GITHUB_REPOSITORY, oldToken = process.env.GITHUB_TOKEN;
  const calls = [];
  process.env.GITHUB_REPOSITORY = 'owner/TR-os'; process.env.GITHUB_TOKEN = 'test-token';
  global.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body });
    if (String(url) === 'https://tr-os.me/api/ready') return jsonResponse(503, { ok: false, services: { membership: 'unavailable' } });
    if (String(url).endsWith('/issues?state=open&per_page=100')) return jsonResponse(200, []);
    return jsonResponse(201, { number: 7 });
  };
  t.after(() => { global.fetch = oldFetch; if (oldRepo === undefined) delete process.env.GITHUB_REPOSITORY; else process.env.GITHUB_REPOSITORY = oldRepo; if (oldToken === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = oldToken; });
  delete require.cache[require.resolve('../.github/scripts/tr-os-uptime.cjs')];
  const monitor = require('../.github/scripts/tr-os-uptime.cjs');
  await monitor.run();
  assert.equal(calls.filter(call => call.method === 'POST' && call.url.endsWith('/issues')).length, 1);
  assert.match(calls.at(-1).body, /tr-os-uptime-monitor/);
});

test('independent monitor closes the existing alert after service recovery', async t => {
  const oldFetch = global.fetch, oldRepo = process.env.GITHUB_REPOSITORY, oldToken = process.env.GITHUB_TOKEN;
  const calls = [];
  process.env.GITHUB_REPOSITORY = 'owner/TR-os'; process.env.GITHUB_TOKEN = 'test-token';
  global.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body });
    if (String(url) === 'https://tr-os.me/api/ready') return jsonResponse(200, { ok: true });
    if (String(url).endsWith('/issues?state=open&per_page=100')) return jsonResponse(200, [{ number: 42, title: '[TR-os] Webbplatsen svarar inte', body: '<!-- tr-os-uptime-monitor -->' }]);
    return jsonResponse(200, { ok: true });
  };
  t.after(() => { global.fetch = oldFetch; if (oldRepo === undefined) delete process.env.GITHUB_REPOSITORY; else process.env.GITHUB_REPOSITORY = oldRepo; if (oldToken === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = oldToken; });
  delete require.cache[require.resolve('../.github/scripts/tr-os-uptime.cjs')];
  const monitor = require('../.github/scripts/tr-os-uptime.cjs');
  await monitor.run();
  assert.ok(calls.some(call => call.method === 'POST' && call.url.endsWith('/issues/42/comments')));
  assert.ok(calls.some(call => call.method === 'PATCH' && call.url.endsWith('/issues/42')));
});
