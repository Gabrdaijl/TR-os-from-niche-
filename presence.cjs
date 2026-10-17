'use strict';
const crypto = require('node:crypto');
const WINDOW_SECONDS = 90;
// Redis time and the count are evaluated atomically, across all app instances.
const SCRIPT = `local t=redis.call('TIME')
local now=tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000)
local cutoff=now-1800000
redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',cutoff)
if ARGV[1]~='' then
 redis.call('ZADD',KEYS[1],now,ARGV[1])
 redis.call('EXPIRE',KEYS[1],3600)
end
return {redis.call('ZCOUNT',KEYS[1],'('..(now-tonumber(ARGV[2])),'+inf'),redis.call('ZCARD',KEYS[1])}`;
function createPresence(env, localCount, request = fetch) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  const configured = !!(url && token);
  async function snapshot(visitorId) {
    const common = { windowSeconds: WINDOW_SECONDS, historyMinutes: 30, configured };
    if (!configured) return { online: env.VERCEL ? null : localCount(), recentVisitors: null, presence: { ...common, source: env.VERCEL ? 'unconfigured' : 'memory' } };
    try {
      const endpoint = new URL(url);
      if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(endpoint.hostname))) throw Error('Invalid Redis URL');
      const id = typeof visitorId === 'string' && /^[a-f0-9-]{36}$/i.test(visitorId) ? crypto.createHash('sha256').update(visitorId).digest('hex') : '';
      const response = await request(endpoint, {
        method: 'POST', redirect: 'error', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: JSON.stringify(['EVAL', SCRIPT, 1, 'tros:presence:browsers:v1', id, WINDOW_SECONDS * 1000]), signal: AbortSignal.timeout(4500)
      });
      if (!response.ok) throw Error('Redis unavailable');
      const data = await response.json();
      if (data.error || !Array.isArray(data.result) || data.result.length !== 2 || data.result.some(n => !Number.isSafeInteger(n) || n < 0)) throw Error('Invalid Redis result');
      return { online: data.result[0], recentVisitors: data.result[1], presence: { ...common, source: 'redis' } };
    } catch {
      return { online: null, recentVisitors: null, presence: { ...common, source: 'unavailable' } };
    }
  }
  return { snapshot, configured };
}
module.exports = { createPresence, WINDOW_SECONDS };
