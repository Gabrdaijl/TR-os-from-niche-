'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createModeration, hashDeviceId } = require('../moderation.cjs');
const { createApp } = require('../server.cjs');

function fakeRedis() {
  const records = new Map();
  const calls = [];
  const request = async (url, init) => {
    const parts = JSON.parse(init.body), [op, , id, value] = parts;
    calls.push(parts);
    let result = 'OK';
    if (op === 'HSET') { records.set(id, value); result = 1; }
    else if (op === 'HEXISTS') result = records.has(parts[2]) ? 1 : 0;
    else if (op === 'HGETALL') result = [...records].flatMap(entry => entry);
    else if (op === 'HDEL') result = records.delete(parts[2]) ? 1 : 0;
    return { ok: true, json: async () => ({ result }) };
  };
  return { records, calls, request };
}

test('moderation persists only a hashed browser ID and fixed reason, then supports unban', async () => {
  const device = crypto.randomBytes(32).toString('base64url');
  const redis = fakeRedis();
  const moderation = createModeration({ KV_REST_API_URL: 'https://redis.example', KV_REST_API_TOKEN: 'test-token' }, redis.request);
  const result = await moderation.ban(device);
  assert.equal(result.ok, true);
  assert.equal(result.source, 'redis');
  const id = hashDeviceId(device);
  assert.equal(result.id, id);
  assert.equal(await moderation.isBanned(device), true);
  const listing = await moderation.list();
  assert.equal(listing.source, 'redis');
  assert.equal(listing.bans.length, 1);
  assert.deepEqual(Object.keys(listing.bans[0]).sort(), ['createdAt', 'id', 'reason']);
  assert.equal(listing.bans[0].reason, 'adult-content-search');
  assert.ok(!JSON.stringify([...redis.records]).includes(device));
  assert.equal((await moderation.unban(id)).removed, true);
  assert.equal(await moderation.isBanned(device), false);
});

test('detected adult searches are stopped before external autocomplete and can be unbanned by admin', async t => {
  const originalFetch = global.fetch;
  const externalCalls = [];
  global.fetch = async (...args) => { externalCalls.push(args); throw new Error('Unexpected external request'); };
  const password = 'moderation-test-password';
  const app = createApp({ env: { ADMIN_PASSWORD: password } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { global.fetch = originalFetch; await app.close(); });
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const localFetch = (...args) => originalFetch(...args);
  const home = await localFetch(base + '/');
  const cookie = home.headers.get('set-cookie').split(';', 1)[0];
  assert.match(cookie, /^tros-device=[A-Za-z0-9_-]{32,64}$/);

  const suggestion = await localFetch(base + '/suggest?q=porn', { headers: { cookie } });
  assert.equal(suggestion.status, 403);
  assert.equal((await suggestion.json()).banned, true);
  assert.equal(externalCalls.length, 0, 'The adult search must not be forwarded to autocomplete');
  const blockedHome = await localFetch(base + '/', { headers: { cookie } });
  const blockedText = await blockedHome.text();
  assert.equal(blockedHome.status, 403, blockedText);
  assert.match(blockedText, /Sökningar efter pornografiskt eller annat sexuellt innehåll utlöser en automatisk spärr/);
  assert.equal((await localFetch(base + '/api/health', { headers: { cookie } })).status, 403);
  assert.equal((await localFetch(base + '/admin.html', { headers: { cookie } })).status, 200);

  const authorization = 'Basic ' + Buffer.from('admin:' + password).toString('base64');
  const listedResponse = await localFetch(base + '/api/admin/moderation/bans', { headers: { authorization } });
  assert.equal(listedResponse.status, 200);
  const listedText = await listedResponse.text();
  assert.ok(!listedText.includes('porn'));
  const listed = JSON.parse(listedText);
  assert.equal(listed.bans.length, 1);
  assert.equal(listed.bans[0].id, hashDeviceId(cookie.slice('tros-device='.length)));

  const remove = await localFetch(base + '/api/admin/moderation/bans/' + listed.bans[0].id, { method: 'DELETE', headers: { authorization } });
  assert.equal(remove.status, 200);
  assert.equal((await localFetch(base + '/', { headers: { cookie } })).status, 200);
  assert.equal((await (await localFetch(base + '/api/admin/moderation/bans', { headers: { authorization } })).json()).bans.length, 0);
});
