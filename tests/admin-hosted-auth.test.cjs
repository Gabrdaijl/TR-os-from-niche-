'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server.cjs');

test('hosted Snapchat creation requires admin authentication and same-origin POST', async t => {
  const app = createApp({ env: { ADMIN_PASSWORD: 'test-only-password' } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = 'http://127.0.0.1:' + app.server.address().port;
  assert.equal((await fetch(base + '/api/admin/snapchat')).status, 405);
  assert.equal((await fetch(base + '/api/admin/snapchat', { method: 'POST' })).status, 401);
  const authorization = 'Basic ' + Buffer.from('admin:test-only-password').toString('base64');
  assert.equal((await fetch(base + '/api/admin/snapchat', {
    method: 'POST', headers: { authorization, origin: 'https://other.invalid' }
  })).status, 403);
  const response = await fetch(base + '/api/admin/snapchat', { method: 'POST', headers: { authorization } });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(base + '/api/admin/snapchat/stop', { method: 'POST' })).status, 401);
});
