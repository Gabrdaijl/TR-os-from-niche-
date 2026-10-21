'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMemberships } = require('../memberships.cjs');
const { createApp } = require('../server.cjs');
const env = { UPSTASH_REDIS_REST_URL: 'https://storage.invalid', UPSTASH_REDIS_REST_TOKEN: 'test-only-token' };

test('membership health uses only PING and coalesces concurrent checks', async () => {
  const commands = [];
  const memberships = createMemberships(env, async (_url, init) => {
    commands.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ result: 'PONG' }) };
  });
  assert.deepEqual(await Promise.all([memberships.health(), memberships.health()]), ['ready', 'ready']);
  assert.equal(await memberships.health(), 'ready');
  assert.deepEqual(commands, [['PING']]);
});

test('membership health reports missing credentials, rejected requests and malformed responses', async () => {
  assert.equal(await createMemberships({}, () => assert.fail('No request without configuration')).health(), 'unconfigured');
  for (const request of [
    async () => { throw new Error('private failure details'); },
    async () => ({ ok: false }),
    async () => ({ ok: true, json: async () => ({ error: 'private storage error' }) }),
    async () => ({ ok: true, json: async () => ({ result: 'not-pong' }) })
  ]) assert.equal(await createMemberships(env, request).health(), 'unavailable');
});

test('readiness detects a database outage while liveness stays available and membership protection stays enforced', async t => {
  for (const state of ['ready', 'unavailable', 'unconfigured']) {
    const app = createApp({ env: {}, memberships: {
      health: async () => state,
      authenticate: async () => { throw Object.assign(new Error('Membership storage unavailable'), { status: 503 }); }
    } });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    t.after(() => app.close());
    const base = 'http://127.0.0.1:' + app.server.address().port;
    const response = await fetch(base + '/api/ready');
    assert.equal(response.status, state === 'ready' ? 200 : 503);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.deepEqual(await response.json(), { ok: state === 'ready', name: 'TR-os', services: { membership: state } });
    assert.equal((await fetch(base + '/api/health')).status, 200);
    assert.equal((await fetch(base + '/')).status, 503);
    assert.equal((await fetch(base + '/api/ready', { method: 'POST' })).status, 405);
  }
});
