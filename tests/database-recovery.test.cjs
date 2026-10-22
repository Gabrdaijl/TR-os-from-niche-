'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { classifyFailure, createRedisCircuit } = require('../redis-circuit.cjs');
const { createMemberships } = require('../memberships.cjs');
const { createModeration } = require('../moderation.cjs');
const { createPresence } = require('../presence.cjs');

const env = { KV_REST_API_URL: 'https://redis.invalid', KV_REST_API_TOKEN: 'test-only-private-token' };
const ok = result => ({ ok: true, json: async () => ({ result }) });

test('database failure categories distinguish quotas without returning provider text or credentials', () => {
  for (const [message, expected] of [
    ['ERR max requests limit exceeded', 'monthly_request_limit'],
    ['ERR max daily request limit exceeded', 'daily_request_limit'],
    ['ERR DB capacity quota exceeded', 'storage_capacity_limit'],
    ['ERR max data size exceeded', 'storage_capacity_limit'],
    ['ERR bandwidth limit exceeded', 'bandwidth_limit'],
    ['ERR budget cap exceeded', 'budget_limit'],
    ['ERR max record size exceeded', 'record_size_limit'],
    ['ERR max request size exceeded', 'request_size_limit'],
    ['NOPERM test-only-private-token cannot read', 'permission_denied'],
    ['Unrecognized private provider details', 'upstream_error']
  ]) assert.equal(classifyFailure(message), expected);
});

test('monthly quota waits five minutes, while storage capacity does not disable reads', t => {
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  const circuit = createRedisCircuit();
  circuit.recordFailure('storage_capacity_limit_http_400');
  assert.equal(circuit.isOpen(), false);
  assert.equal(circuit.diagnostics().lastFailure, 'storage_capacity_limit_http_400');
  circuit.recordFailure('monthly_request_limit_http_400');
  assert.deepEqual(circuit.diagnostics(), {
    open: true, retryAfterMs: 300_000, lastFailure: 'monthly_request_limit_http_400'
  });
  now += 299_999;
  assert.equal(circuit.isOpen(), true);
  now++;
  assert.equal(circuit.isOpen(), false);
  circuit.recordSuccess();
  assert.deepEqual(circuit.diagnostics(), { open: false, retryAfterMs: 0, lastFailure: null });
});

test('moderation shares quota backoff and does not keep calling Redis after rejection', async t => {
  t.mock.method(console, 'warn', () => {});
  const circuit = createRedisCircuit();
  let calls = 0;
  const moderation = createModeration(env, async (_url, init) => {
    calls++;
    assert.equal(JSON.parse(init.body)[0], 'HEXISTS');
    return { ok: false, status: 400, text: async () => 'ERR max requests limit exceeded' };
  }, circuit);
  const device = crypto.randomBytes(32).toString('base64url');
  assert.equal(await moderation.isBanned(device), false);
  assert.equal(await moderation.isBanned(device), false);
  assert.equal(calls, 1);
  assert.equal(circuit.diagnostics().lastFailure, 'monthly_request_limit_http_400');
  const memberships = createMemberships(env, () => assert.fail('Shared quota circuit must prevent a second network call'), circuit);
  assert.deepEqual(await memberships.healthDetails(), { status: 'unavailable', reason: 'monthly_request_limit_http_400' });
});

test('membership authentication uses one read-only script and validates session, device and enabled state', async () => {
  const token = crypto.randomBytes(32).toString('base64url');
  const sessionHash = crypto.createHash('sha256').update(token).digest('hex');
  const session = { userId: 'member-id', deviceType: 'computer', deviceId: 'bound-device' };
  const user = { id: 'member-id', enabled: true, paidUntilMs: Date.now() + 60_000,
    devices: { computer: { sessionHash, deviceId: 'bound-device' } } };
  for (const [storedSession, storedUser, accepted] of [
    [session, user, true],
    [session, { ...user, enabled: false }, false],
    [session, { ...user, devices: {} }, false],
    [session, { ...user, devices: { computer: { sessionHash: 'replaced-session', deviceId: 'bound-device' } } }, false],
    [session, { ...user, devices: { computer: { sessionHash, deviceId: 'another-device' } } }, false],
    [{ ...session, deviceType: 'invalid' }, user, false]
  ]) {
    let calls = 0;
    const memberships = createMemberships(env, async (_url, init) => {
      calls++;
      const parts = JSON.parse(init.body);
      assert.equal(parts[0], 'EVAL_RO');
      assert.equal(parts[2], 1);
      assert.equal(parts[3], 'tros:membership:v1:session:' + sessionHash);
      assert.doesNotMatch(parts[1], /redis\.call\('(SET|DEL|EXPIRE|HSET)'/);
      return ok([JSON.stringify(storedSession), JSON.stringify(storedUser)]);
    });
    const account = await memberships.authenticate({ headers: { cookie: 'tros-session=' + token } });
    assert.equal(!!account, accepted);
    if (accepted) assert.equal(account.user.id, 'member-id');
    assert.equal(calls, 1);
  }
});

test('missing or malformed membership cookies do not query storage', async () => {
  const memberships = createMemberships(env, () => assert.fail('Malformed credentials must not hit Redis'));
  assert.equal(await memberships.authenticate({ headers: {} }), null);
  assert.equal(await memberships.authenticate({ headers: { cookie: 'tros-session=short' } }), null);
});

test('admin member and payment lists use read-only scripts', async () => {
  const commands = [];
  const memberships = createMemberships(env, async (_url, init) => {
    const parts = JSON.parse(init.body);
    commands.push(parts);
    return ok([]);
  });
  assert.deepEqual(await memberships.listUsers(), []);
  assert.deepEqual(await memberships.listPayments(), []);
  assert.equal(commands.length, 2);
  for (const command of commands) {
    assert.equal(command[0], 'EVAL_RO');
    assert.doesNotMatch(command[1], /redis\.call\('(SET|DEL|EXPIRE|HSET)'/);
  }
});

test('presence snapshots are read-only and browser heartbeats retain atomic writes', async () => {
  const commands = [];
  const presence = createPresence(env, () => 0, async (_url, init) => {
    const parts = JSON.parse(init.body);
    commands.push(parts);
    return ok([2, 5]);
  });
  assert.equal((await presence.snapshot()).online, 2);
  assert.equal((await presence.snapshot(crypto.randomUUID())).recentVisitors, 5);
  assert.equal(commands[0][0], 'EVAL_RO');
  assert.equal(commands[0][4], '');
  assert.equal(commands[1][0], 'EVAL');
  assert.match(commands[1][4], /^[a-f0-9]{64}$/);
  assert.ok(commands[0][1].indexOf("if ARGV[1]~='' then") < commands[0][1].indexOf("redis.call('ZREMRANGEBYSCORE'"));
  assert.doesNotMatch(commands[0][1], /ZCARD/);
  assert.equal(commands[0][5], 90_000);
});

test('a capacity-rejected heartbeat still allows the following read-only presence snapshot', async t => {
  t.mock.method(console, 'warn', () => {});
  const commands = [];
  const circuit = createRedisCircuit();
  const presence = createPresence(env, () => 0, async (_url, init) => {
    const parts = JSON.parse(init.body);
    commands.push(parts[0]);
    return parts[0] === 'EVAL'
      ? { ok: false, status: 400, text: async () => 'ERR DB capacity quota exceeded' }
      : ok([1, 4]);
  }, circuit);
  assert.equal((await presence.snapshot(crypto.randomUUID())).presence.source, 'unavailable');
  assert.equal(circuit.isOpen(), false);
  assert.equal((await presence.snapshot()).presence.source, 'redis');
  assert.deepEqual(commands, ['EVAL', 'EVAL_RO']);
});
