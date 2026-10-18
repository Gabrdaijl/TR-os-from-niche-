'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server.cjs');

test('removed hosted Snapchat endpoints cannot create or restore a browser even with configured credentials', async t => {
  const app = createApp({ env: {
    ADMIN_PASSWORD: 'test-only-password', BROWSERBASE_API_KEY: 'unused-test-key',
    BROWSERBASE_PROJECT_ID: 'unused-test-project', KV_REST_API_URL: 'https://redis.invalid', KV_REST_API_TOKEN: 'unused-redis-token'
  } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = 'http://127.0.0.1:' + app.server.address().port;
  for (const suffix of ['', '/stop', '/forget']) {
    const response = await fetch(base + '/api/admin/snapchat' + suffix, {
      method: 'POST', headers: { authorization: 'Basic ' + Buffer.from('admin:test-only-password').toString('base64') }
    });
    assert.equal(response.status, 410);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const data = await response.json();
    assert.equal(data.error, 'Snapchat-testet är borttaget.');
    assert.equal(Object.hasOwn(data, 'url'), false);
  }
});