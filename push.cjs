'use strict';

const crypto = require('node:crypto');
const webpush = require('web-push');

const VAPID_KEY = '{tros:push}:vapid:v1';
const ADMIN_KEY = '{tros:push}:admins:v1';
const USER_PREFIX = '{tros:push}:browser:v1:';
const MAX_SUBSCRIPTIONS = 30;

function createPushNotifications(env = process.env, request = fetch, webPush = webpush) {
  const endpointValue = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  let endpoint = null;
  try {
    const url = new URL(endpointValue);
    if (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) endpoint = url;
  } catch {}

  async function redis(parts) {
    if (!endpoint || !token) throw new Error('Push notifications require Redis storage');
    const response = await request(endpoint, {
      method: 'POST', redirect: 'error',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify(parts), signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error('Push notification storage unavailable');
    const data = await response.json();
    if (data.error) throw new Error('Push notification storage unavailable');
    return data.result;
  }

  let keyPromise;
  async function vapidKeys() {
    if (!keyPromise) keyPromise = (async () => {
      let keys;
      if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
        keys = { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
      } else {
        if (!endpoint || !token) return null;
        let stored = await redis(['GET', VAPID_KEY]);
        if (!stored) {
          const generated = webPush.generateVAPIDKeys();
          const result = await redis(['SET', VAPID_KEY, JSON.stringify(generated), 'NX']);
          stored = result === 'OK' ? JSON.stringify(generated) : await redis(['GET', VAPID_KEY]);
        }
        keys = typeof stored === 'string' ? JSON.parse(stored) : null;
      }
      if (!keys || typeof keys.publicKey !== 'string' || typeof keys.privateKey !== 'string') return null;
      webPush.setVapidDetails(env.VAPID_SUBJECT || 'https://tr-os.me', keys.publicKey, keys.privateKey);
      return keys;
    })();
    return keyPromise;
  }

  function endpointHash(subscription) {
    return crypto.createHash('sha256').update(subscription.endpoint).digest('hex');
  }

  function validSubscription(subscription) {
    if (!subscription || typeof subscription !== 'object' || Array.isArray(subscription)) return false;
    if (JSON.stringify(subscription).length > 5000 || typeof subscription.endpoint !== 'string') return false;
    try {
      const url = new URL(subscription.endpoint);
      const host = url.hostname.toLowerCase();
      const allowedHost = host === 'fcm.googleapis.com' || host === 'web.push.apple.com' || host.endsWith('.push.services.mozilla.com') || host.endsWith('.notify.windows.com');
      return url.protocol === 'https:' && allowedHost &&
        typeof subscription.keys?.p256dh === 'string' && subscription.keys.p256dh.length >= 80 && subscription.keys.p256dh.length <= 200 &&
        typeof subscription.keys?.auth === 'string' && subscription.keys.auth.length >= 20 && subscription.keys.auth.length <= 64;
    } catch { return false; }
  }

  function subscriptionKey(role, deviceId) {
    if (role === 'admin') return ADMIN_KEY;
    if (role !== 'browser' || typeof deviceId !== 'string' || !/^[a-f0-9]{64}$/.test(deviceId)) return '';
    return USER_PREFIX + deviceId;
  }

  async function register(role, deviceId, subscription) {
    const key = subscriptionKey(role, deviceId);
    if (!key || !validSubscription(subscription)) return { ok: false, reason: 'Ogiltig notifieringsprenumeration.' };
    if (!(await vapidKeys())) return { ok: false, reason: 'Pushnotiser kräver den anslutna Redis-databasen.' };
    const hash = endpointHash(subscription);
    await redis(['HSET', key, hash, JSON.stringify({ subscription, savedAt: Date.now() })]);
    await redis(['EXPIRE', key, 15552000]);
    const entries = await redis(['HGETALL', key]);
    if (Array.isArray(entries) && entries.length > MAX_SUBSCRIPTIONS * 2) {
      const old = [];
      for (let index = 0; index + 1 < entries.length; index += 2) {
        if (entries[index] === hash) continue;
        try { old.push([entries[index], JSON.parse(entries[index + 1]).savedAt || 0]); } catch { old.push([entries[index], 0]); }
      }
      old.sort((a, b) => a[1] - b[1]);
      for (const [oldHash] of old.slice(0, entries.length / 2 - MAX_SUBSCRIPTIONS)) await redis(['HDEL', key, oldHash]);
    }
    return { ok: true };
  }

  async function remove(role, deviceId, subscription) {
    const key = subscriptionKey(role, deviceId);
    if (!key || typeof subscription?.endpoint !== 'string') return { ok: false };
    await redis(['HDEL', key, endpointHash(subscription)]);
    return { ok: true };
  }

  async function deliver(key, payload) {
    if (!(await vapidKeys())) return { ok: false, sent: 0, reason: 'Pushnotiser är inte konfigurerade.' };
    const entries = await redis(['HGETALL', key]);
    if (!Array.isArray(entries)) return { ok: true, sent: 0 };
    const title = String(payload.title || 'TR-os').slice(0, 80);
    const body = String(payload.body || '').slice(0, 180);
    const target = typeof payload.url === 'string' && payload.url.startsWith('/') && !payload.url.startsWith('//') ? payload.url.slice(0, 200) : '/';
    const data = JSON.stringify({ title, body, url: target, tag: String(payload.tag || 'tr-os').slice(0, 100), timestamp: Date.now(), requireInteraction: payload.requireInteraction === true });
    let sent = 0;
    await Promise.all(entries.reduce((tasks, value, index) => {
      if (index % 2) return tasks;
      const hash = value, raw = entries[index + 1];
      let subscription;
      try { subscription = JSON.parse(raw).subscription; } catch {}
      if (!validSubscription(subscription)) { tasks.push(redis(['HDEL', key, hash]).catch(() => {})); return tasks; }
      tasks.push(webPush.sendNotification(subscription, data, { TTL: 3600, urgency: 'high', timeout: 5000 }).then(() => { sent++; }).catch(error => {
        const status = Number(error.statusCode || error.status);
        if (status === 404 || status === 410) return redis(['HDEL', key, hash]).catch(() => {});
        return undefined;
      }));
      return tasks;
    }, []));
    return { ok: true, sent };
  }

  function notifyAdmins(title, body, url = '/admin.html', tag = 'admin') {
    const requireInteraction = /swish|kundkonto|supportmeddelande|felrapport|ny spärr|verkar vara nere/i.test(String(title));
    return deliver(ADMIN_KEY, { title, body, url, tag, requireInteraction });
  }

  function notifyBrowser(deviceId, title, body, url = '/support.html', tag = 'support') {
    const key = subscriptionKey('browser', deviceId);
    return key ? deliver(key, { title, body, url, tag }) : Promise.resolve({ ok: false, sent: 0 });
  }

  return Object.freeze({ publicKey: async () => (await vapidKeys())?.publicKey || '', registerAdmin: subscription => register('admin', '', subscription), removeAdmin: subscription => remove('admin', '', subscription), registerBrowser: (deviceId, subscription) => register('browser', deviceId, subscription), removeBrowser: (deviceId, subscription) => remove('browser', deviceId, subscription), notifyAdmins, notifyBrowser, configured: !!endpoint && !!token });
}

module.exports = { ADMIN_KEY, USER_PREFIX, VAPID_KEY, createPushNotifications };
