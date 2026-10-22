'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMemberships } = require('../memberships.cjs');
const { createApp } = require('../server.cjs');
const env = { UPSTASH_REDIS_REST_URL: 'https://storage.invalid', UPSTASH_REDIS_REST_TOKEN: 'test-only-token' };

test('membership health checks PING and read-only script access and coalesces concurrent checks', async () => {
  const commands = [];
  const memberships = createMemberships(env, async (_url, init) => {
    const command = JSON.parse(init.body);
    commands.push(command);
    return { ok: true, json: async () => ({ result: command[0] === 'PING' ? 'PONG' : null }) };
  });
  assert.deepEqual(await Promise.all([memberships.health(), memberships.health()]), ['ready', 'ready']);
  assert.equal(await memberships.health(), 'ready');
  assert.deepEqual(commands, [['PING'], ['EVAL_RO', "return redis.call('GET',KEYS[1])", 1, 'tros:membership:v1:health:probe']]);
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

test('membership readiness exposes only a safe category for upstream read errors', async () => {
  const memberships = createMemberships(env, async (_url, init) => JSON.parse(init.body)[0] === 'PING'
    ? { ok: true, json: async () => ({ result: 'PONG' }) }
    : {
      ok: false, status: 400,
      text: async () => JSON.stringify({ error: 'NOPERM this user has no permissions to access one of the keys used as arguments' })
    });
  assert.deepEqual(await memberships.healthDetails(), {
    status: 'unavailable', reason: 'permission_denied_http_400'
  });
});

test('readiness detects a database outage while liveness stays available and membership protection stays enforced', async t => {
  for (const state of ['ready', 'unavailable', 'unconfigured']) {
    const app = createApp({ env: {}, memberships: {
      healthDetails: async () => ({ status: state, reason: state === 'ready' ? 'ok' : 'upstream_unavailable' }),
      authenticate: async () => { throw Object.assign(new Error('Membership storage unavailable'), { status: 503 }); }
    } });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    t.after(() => app.close());
    const base = 'http://127.0.0.1:' + app.server.address().port;
    const response = await fetch(base + '/api/ready');
    assert.equal(response.status, state === 'ready' ? 200 : 503);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.deepEqual(await response.json(), {
      ok: state === 'ready', name: 'TR-os', services: { membership: state },
      diagnostics: { membership: state === 'ready' ? 'ok' : 'upstream_unavailable' }
    });
    assert.equal((await fetch(base + '/api/health')).status, 200);
    assert.equal((await fetch(base + '/')).status, 503);
    assert.equal((await fetch(base + '/api/ready', { method: 'POST' })).status, 405);
  }
});
