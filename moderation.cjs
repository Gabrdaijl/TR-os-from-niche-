'use strict';
const crypto = require('node:crypto');

const COOKIE = 'tros-device';
const REDIS_KEY = 'tros:moderation:bans:v1';
const CONVERSATIONS_KEY = 'tros:moderation:conversations:v1';
const CONVERSATION_INDEX_KEY = 'tros:moderation:conversations:index:v1';
const DEVICE_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;
const ID_PATTERN = /^[a-f0-9]{64}$/;
const MAX_MESSAGES = 100;

function cookieDeviceId(header = '') {
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index < 0 || part.slice(0, index).trim() !== COOKIE) continue;
    const value = part.slice(index + 1).trim();
    return DEVICE_PATTERN.test(value) ? value : '';
  }
  return '';
}

function hashDeviceId(value) {
  if (typeof value !== 'string' || !DEVICE_PATTERN.test(value)) return '';
  return crypto.createHash('sha256').update(value).digest('hex');
}

function createModeration(env = process.env, request = fetch) {
  const endpointValue = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  const memory = new Map();
  const conversations = new Map();
  let endpoint = null;
  try {
    if (endpointValue && token) {
      const url = new URL(endpointValue);
      if (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) endpoint = url;
    }
  } catch {}

  async function command(parts) {
    if (!endpoint || !token) throw new Error('Moderation storage is not configured');
    const response = await request(endpoint, {
      method: 'POST', redirect: 'error',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify(parts), signal: AbortSignal.timeout(4500)
    });
    if (!response.ok) throw new Error('Moderation storage is unavailable');
    const data = await response.json();
    if (data.error) throw new Error('Moderation storage is unavailable');
    return data.result;
  }

  function publicRecord(id, value) {
    try {
      const record = typeof value === 'string' ? JSON.parse(value) : value;
      if (!record || record.reason !== 'adult-content-search' || typeof record.createdAt !== 'string') return null;
      return { id, createdAt: record.createdAt, reason: record.reason };
    } catch { return null; }
  }

  async function isBanned(deviceId) {
    const id = hashDeviceId(deviceId);
    if (!id) return false;
    if (memory.has(id)) return true;
    if (!endpoint) return false;
    try { return !!(await command(['HEXISTS', REDIS_KEY, id])); }
    catch { return false; }
  }

  async function ban(deviceId) {
    const id = hashDeviceId(deviceId);
    if (!id) return { ok: false, source: 'unavailable' };
    const record = { createdAt: new Date().toISOString(), reason: 'adult-content-search' };
    memory.set(id, record);
    if (!endpoint) return { ok: true, id, createdAt: record.createdAt, source: 'memory' };
    try {
      await command(['HSET', REDIS_KEY, id, JSON.stringify(record)]);
      return { ok: true, id, createdAt: record.createdAt, source: 'redis' };
    } catch {
      return { ok: true, id, createdAt: record.createdAt, source: 'memory-fallback' };
    }
  }

  async function list() {
    if (!endpoint) return { source: 'memory', bans: [...memory].map(([id, record]) => publicRecord(id, record)).filter(Boolean) };
    try {
      const values = await command(['HGETALL', REDIS_KEY]);
      if (!Array.isArray(values) || values.length % 2 !== 0) throw new Error('Invalid moderation records');
      const records = new Map();
      for (let index = 0; index < values.length; index += 2) {
        const id = values[index];
        if (typeof id !== 'string' || !ID_PATTERN.test(id)) continue;
        const record = publicRecord(id, values[index + 1]);
        if (record) records.set(id, record);
      }
      for (const [id, value] of memory) if (!records.has(id)) {
        const record = publicRecord(id, value);
        if (record) records.set(id, record);
      }
      return { source: 'redis', bans: [...records.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
    } catch {
      return { source: 'memory-fallback', bans: [...memory].map(([id, record]) => publicRecord(id, record)).filter(Boolean) };
    }
  }

  async function unban(id) {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) return { removed: false, source: endpoint ? 'redis' : 'memory' };
    const inMemory = memory.delete(id);
    if (!endpoint) return { removed: inMemory, source: 'memory' };
    try {
      const removed = Number(await command(['HDEL', REDIS_KEY, id])) > 0;
      return { removed: removed || inMemory, source: 'redis' };
    } catch {
      if (inMemory) return { removed: true, source: 'memory-fallback' };
      return { removed: false, source: 'unavailable' };
    }
  }

  function validText(text) {
    if (typeof text !== 'string') return '';
    const value = text.trim();
    return value.length >= 1 && value.length <= 2000 ? value : '';
  }

  async function conversation(id) {
    if (!ID_PATTERN.test(id)) return [];
    if (!endpoint) return conversations.get(id)?.messages || [];
    try {
      const value = await command(['HGET', CONVERSATIONS_KEY, id]);
      const messages = value ? JSON.parse(value) : [];
      return Array.isArray(messages) ? messages : [];
    } catch { return conversations.get(id)?.messages || []; }
  }

  async function send(id, role, rawText) {
    const text = validText(rawText);
    if (!ID_PATTERN.test(id) || !text || !['browser', 'admin'].includes(role)) return { ok: false };
    const messages = (await conversation(id)).slice(-MAX_MESSAGES + 1);
    const message = { id: crypto.randomUUID(), role, text, createdAt: new Date().toISOString() };
    messages.push(message);
    const updatedAt = Date.now();
    conversations.set(id, { messages, updatedAt });
    if (!endpoint) return { ok: true, message, source: 'memory' };
    try {
      await Promise.all([
        command(['HSET', CONVERSATIONS_KEY, id, JSON.stringify(messages)]),
        command(['ZADD', CONVERSATION_INDEX_KEY, updatedAt, id])
      ]);
      return { ok: true, message, source: 'redis' };
    } catch { return { ok: true, message, source: 'memory-fallback' }; }
  }

  async function messagesForDevice(deviceId) {
    const id = hashDeviceId(deviceId);
    return { id, messages: await conversation(id) };
  }

  async function hasConversation(deviceId) {
    const id = hashDeviceId(deviceId);
    return !!id && (await conversation(id)).length > 0;
  }

  async function deleteConversation(id) {
    if (!ID_PATTERN.test(id)) return { removed: false, source: endpoint ? 'redis' : 'memory' };
    if (!endpoint) return { removed: conversations.delete(id), source: 'memory' };
    const script = `local removed=redis.call('HDEL',KEYS[1],ARGV[1])
redis.call('ZREM',KEYS[2],ARGV[1])
return removed`;
    try {
      const removed = Number(await command(['EVAL', script, 2, CONVERSATIONS_KEY, CONVERSATION_INDEX_KEY, id])) > 0;
      conversations.delete(id);
      return { removed, source: 'redis' };
    } catch {
      return { removed: false, source: 'unavailable' };
    }
  }

  async function listConversations() {
    if (!endpoint) return { source: 'memory', conversations: [...conversations.entries()].map(([id, value]) => ({ id, ...value })).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50) };
    try {
      const ids = await command(['ZREVRANGE', CONVERSATION_INDEX_KEY, 0, 49]);
      if (!Array.isArray(ids)) throw new Error('Invalid conversation index');
      const result = await Promise.all(ids.filter(id => ID_PATTERN.test(id)).map(async id => ({ id, messages: await conversation(id) })));
      return { source: 'redis', conversations: result.map(item => ({ ...item, updatedAt: Date.parse(item.messages.at(-1)?.createdAt || '') || 0 })).sort((a, b) => b.updatedAt - a.updatedAt) };
    } catch {
      return { source: 'memory-fallback', conversations: [...conversations.entries()].map(([id, value]) => ({ id, ...value })).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50) };
    }
  }

  return Object.freeze({ isBanned, ban, list, unban, messagesForDevice, hasConversation, deleteConversation, sendBrowserMessage: (deviceId, text) => send(hashDeviceId(deviceId), 'browser', text), sendAdminMessage: (id, text) => send(id, 'admin', text), listConversations, configured: !!endpoint, cookieName: COOKIE });
}

module.exports = { COOKIE, REDIS_KEY, CONVERSATIONS_KEY, CONVERSATION_INDEX_KEY, cookieDeviceId, createModeration, hashDeviceId };
