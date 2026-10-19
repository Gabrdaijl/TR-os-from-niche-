'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createPushNotifications } = require('../push.cjs');

function fakeRedis() {
  const strings = new Map(), hashes = new Map();
  const request = async (_url, init) => {
    const parts = JSON.parse(init.body), [op, key, field, value] = parts;
    let result = 'OK';
    if (op === 'GET') result = strings.get(key) || null;
    else if (op === 'SET') {
      if (parts[3] === 'NX' && strings.has(key)) result = null;
      else strings.set(key, field);
    } else if (op === 'HSET') {
      const hash = hashes.get(key) || new Map(); hash.set(field, value); hashes.set(key, hash); result = 1;
    } else if (op === 'HGETALL') result = [...(hashes.get(key) || new Map())].flatMap(entry => entry);
    else if (op === 'HDEL') result = hashes.get(key)?.delete(field) ? 1 : 0;
    return { ok: true, json: async () => ({ result }) };
  };
  return { strings, hashes, request };
}

function fakeWebPush() {
  return {
    sent: [],
    generated: 0,
    generateVAPIDKeys() { this.generated++; return { publicKey: 'generated-public-key', privateKey: 'generated-private-key' }; },
    setVapidDetails(subject, publicKey, privateKey) { this.vapid = { subject, publicKey, privateKey }; },
    async sendNotification(subscription, payload, options) { this.sent.push({ subscription, payload, options }); }
  };
}

function subscription(endpoint = 'https://fcm.googleapis.com/fcm/send/test') {
  return { endpoint, keys: { p256dh: crypto.randomBytes(65).toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
}

test('push keeps VAPID secret server-side, stores admin subscriptions and sends a bounded notification', async () => {
  const redis = fakeRedis(), webPush = fakeWebPush();
  const service = createPushNotifications({ KV_REST_API_URL: 'https://redis.example', KV_REST_API_TOKEN: 'test-token', VAPID_PUBLIC_KEY: 'public-key', VAPID_PRIVATE_KEY: 'private-key' }, redis.request, webPush);
  const sub = subscription();
  assert.equal(await service.publicKey(), 'public-key');
  assert.deepEqual(await service.registerAdmin(sub), { ok: true });
  const result = await service.notifyAdmins('Ny spärr', 'En webbläsare har blockerats.', '/admin.html#bans', 'ban');
  assert.deepEqual(result, { ok: true, sent: 1 });
  assert.deepEqual(webPush.vapid, { subject: 'https://tr-os.me', publicKey: 'public-key', privateKey: 'private-key' });
  const sent = JSON.parse(webPush.sent[0].payload);
  assert.deepEqual(sent, { title: 'Ny spärr', body: 'En webbläsare har blockerats.', url: '/admin.html#bans', tag: 'ban' });
  assert.equal(webPush.sent[0].subscription.endpoint, sub.endpoint);
  assert.deepEqual(await service.removeAdmin(sub), { ok: true });
  assert.deepEqual(await service.notifyAdmins('Ny spärr', 'Något nytt.'), { ok: true, sent: 0 });
});

test('browser push is scoped to hashed device IDs and rejects arbitrary endpoint hosts', async () => {
  const redis = fakeRedis(), webPush = fakeWebPush();
  const service = createPushNotifications({ KV_REST_API_URL: 'https://redis.example', KV_REST_API_TOKEN: 'test-token', VAPID_PUBLIC_KEY: 'public-key', VAPID_PRIVATE_KEY: 'private-key' }, redis.request, webPush);
  const deviceA = crypto.randomBytes(32).toString('base64url'), deviceB = crypto.randomBytes(32).toString('base64url');
  const idA = crypto.createHash('sha256').update(deviceA).digest('hex');
  assert.equal((await service.registerBrowser(idA, subscription('https://attacker.example/push'))).ok, false);
  const sub = subscription('https://web.push.apple.com/test');
  assert.equal((await service.registerBrowser(idA, sub)).ok, true);
  assert.deepEqual(await service.notifyBrowser(idA, 'Nytt svar', 'Admin har svarat.'), { ok: true, sent: 1 });
  assert.deepEqual(await service.notifyBrowser(crypto.createHash('sha256').update(deviceB).digest('hex'), 'Nytt svar', 'Admin har svarat.'), { ok: true, sent: 0 });
});

test('push stays disabled without persistent Redis configuration', async () => {
  const service = createPushNotifications({}, async () => { throw new Error('Unexpected request'); }, fakeWebPush());
  assert.equal(await service.publicKey(), '');
  assert.equal((await service.registerAdmin(subscription())).ok, false);
});

test('a generated VAPID key pair is persisted and reused across server instances', async () => {
  const redis = fakeRedis(), firstWebPush = fakeWebPush(), secondWebPush = fakeWebPush();
  const env = { KV_REST_API_URL: 'https://redis.example', KV_REST_API_TOKEN: 'test-token' };
  const first = createPushNotifications(env, redis.request, firstWebPush);
  assert.equal(await first.publicKey(), 'generated-public-key');
  const second = createPushNotifications(env, redis.request, secondWebPush);
  assert.equal(await second.publicKey(), 'generated-public-key');
  assert.equal(firstWebPush.generated, 1);
  assert.equal(secondWebPush.generated, 0);
  assert.equal(secondWebPush.vapid.privateKey, 'generated-private-key');
});
