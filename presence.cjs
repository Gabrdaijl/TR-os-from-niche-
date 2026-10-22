'use strict';
const crypto = require('node:crypto');
const { createRedisCircuit, classifyFailure } = require('./redis-circuit.cjs');
const { createRedisStorage } = require('./redis-storage.cjs');
const WINDOW_SECONDS = 90;
// Redis time and the count are evaluated atomically, across all app instances.
const SCRIPT = `local t=redis.call('TIME')
local now=tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000)
local cutoff=now-1800000
if ARGV[1]~='' then
 redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',cutoff)
 redis.call('ZADD',KEYS[1],now,ARGV[1])
 redis.call('EXPIRE',KEYS[1],3600)
end
return {redis.call('ZCOUNT',KEYS[1],'('..(now-tonumber(ARGV[2])),'+inf'),redis.call('ZCOUNT',KEYS[1],'('..cutoff,'+inf')}`;
function createPresence(env, localCount, request = fetch, redisCircuit = createRedisCircuit()) {
  const storage = createRedisStorage(env, request);
  const { endpoint, token, configured } = storage;
  async function snapshot(visitorId) {
    const common = { windowSeconds: WINDOW_SECONDS, historyMinutes: 30, configured };
    if (!configured) return { online: env.VERCEL ? null : localCount(), recentVisitors: null, presence: { ...common, source: env.VERCEL ? 'unconfigured' : 'memory' } };
    if (redisCircuit.isOpen()) return { online: null, recentVisitors: null, presence: { ...common, source: 'unavailable' } };
    let failureReason = 'upstream_unavailable';
    try {
      const id = typeof visitorId === 'string' && /^[a-f0-9-]{36}$/i.test(visitorId) ? crypto.createHash('sha256').update(visitorId).digest('hex') : '';
      const response = await storage.request(endpoint, {
        method: 'POST', redirect: 'error', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: JSON.stringify([id ? 'EVAL' : 'EVAL_RO', SCRIPT, 1, 'tros:presence:browsers:v1', id, WINDOW_SECONDS * 1000]), signal: AbortSignal.timeout(4500)
      });
      if (!response.ok) {
        let message = '';
        try { message = (await response.text()).slice(0, 2048); } catch {}
        failureReason = classifyFailure(message);
        if (failureReason === 'upstream_error') failureReason = 'upstream_unavailable';
        if (Number.isInteger(response.status)) failureReason += '_http_' + response.status;
        throw Error('Redis unavailable');
      }
      const data = await response.json();
      if (data.error) {
        failureReason = classifyFailure(data.error);
        if (failureReason === 'upstream_error') failureReason = 'redis_command_error';
        throw Error('Redis command failed');
      }
      if (!Array.isArray(data.result) || data.result.length !== 2 || data.result.some(n => !Number.isSafeInteger(n) || n < 0)) {
        failureReason = 'invalid_response';
        throw Error('Invalid Redis result');
      }
      redisCircuit.recordSuccess();
      return { online: data.result[0], recentVisitors: data.result[1], presence: { ...common, source: 'redis' } };
    } catch {
      redisCircuit.recordFailure(failureReason);
      console.warn('[presence-storage] Redis REST failure', { reason: failureReason });
      return { online: null, recentVisitors: null, presence: { ...common, source: 'unavailable' } };
    }
  }
  return { snapshot, configured };
}
module.exports = { createPresence, WINDOW_SECONDS };
