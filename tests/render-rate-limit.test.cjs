'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server.cjs');

async function fixture(t, env = {}) {
  const app = createApp({ env: { ADMIN_PASSWORD: 'test-only-password', ...env } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = 'http://127.0.0.1:' + app.server.address().port;
  return async headers => {
    const response = await fetch(base + '/api/admin/status', { headers });
    await response.arrayBuffer();
    return response.status;
  };
}

test('Render limits each verified client independently behind the same ingress', async t => {
  const request = await fixture(t, { RENDER: 'true' });
  for (let i = 0; i < 5; i++) assert.equal(await request({ 'cf-connecting-ip': '203.0.113.1' }), 401);
  assert.equal(await request({ 'cf-connecting-ip': '203.0.113.1' }), 429);
  assert.equal(await request({ 'cf-connecting-ip': '203.0.113.2' }), 401);
  assert.equal(await request({ 'cf-connecting-ip': '2001:db8::1' }), 401);
  assert.equal(await request({ 'cf-connecting-ip': '203.0.113.1', 'x-forwarded-for': '198.51.100.22' }), 429);
});

test('Render rejects malformed proxy identities and ignores forged forwarding chains', async t => {
  const request = await fixture(t, { RENDER: 'true' });
  for (let i = 0; i < 5; i++) {
    assert.equal(await request({ 'cf-connecting-ip': 'invalid-' + i, 'x-forwarded-for': '198.51.100.' + i }), 401);
  }
  for (const value of ['', '203.0.113.1, 203.0.113.2', '127.0.0.1:1234', 'unknown']) {
    assert.equal(await request({ 'cf-connecting-ip': value, 'x-forwarded-for': '203.0.113.9' }), 429);
  }
  assert.equal(await request({ 'x-forwarded-for': '203.0.113.10' }), 429);
});

test('direct hosting never trusts caller-supplied proxy headers', async t => {
  for (const env of [{}, { RENDER: 'false' }]) {
    const request = await fixture(t, env);
    for (let i = 0; i < 5; i++) {
      assert.equal(await request({ 'cf-connecting-ip': '203.0.113.' + i, 'x-forwarded-for': '198.51.100.' + i }), 401);
    }
    assert.equal(await request({ 'cf-connecting-ip': '2001:db8::2', 'x-forwarded-for': '198.51.100.20' }), 429);
  }
});

test('a configured reverse proxy preserves separate limits for each actual client', async t => {
  const request = await fixture(t, { TR_OS_TRUSTED_PROXY_IP: '127.0.0.1' });
  for (let i = 0; i < 5; i++) assert.equal(await request({ 'x-tros-client-ip': '203.0.113.1' }), 401);
  assert.equal(await request({ 'x-tros-client-ip': '203.0.113.1' }), 429);
  assert.equal(await request({ 'x-tros-client-ip': '203.0.113.2' }), 401);
  assert.equal(await request({ 'x-tros-client-ip': '2001:db8::1' }), 401);
});

test('custom forwarding headers from untrusted peers or malformed values cannot reset limits', async t => {
  for (const proxyIp of ['', 'not-an-ip', '192.0.2.10']) {
    const request = await fixture(t, { TR_OS_TRUSTED_PROXY_IP: proxyIp });
    for (let i = 0; i < 5; i++) assert.equal(await request({ 'x-tros-client-ip': '203.0.113.' + i }), 401);
    assert.equal(await request({ 'x-tros-client-ip': '2001:db8::1' }), 429);
  }
  const request = await fixture(t, { TR_OS_TRUSTED_PROXY_IP: '127.0.0.1' });
  for (let i = 0; i < 5; i++) assert.equal(await request({ 'x-tros-client-ip': 'invalid-' + i }), 401);
  assert.equal(await request({ 'x-tros-client-ip': '203.0.113.1, 203.0.113.2' }), 429);
});
