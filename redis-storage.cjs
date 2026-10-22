'use strict';

// Storage modules keep the existing Redis REST response contract. Native mode
// translates it locally; credentials and commands never go through an HTTP hop.
const nativeConnections = new WeakMap();

function restSettings(env) {
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  try {
    const endpoint = new URL(env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
    if (!token || (endpoint.protocol !== 'https:' && !(local && endpoint.protocol === 'http:'))) return {};
    if (endpoint.username || endpoint.password) return {};
    return { endpoint, token };
  } catch { return {}; }
}

function nativeSettings(env) {
  try {
    const endpoint = new URL(env.VALKEY_URL || env.REDIS_URL);
    if (endpoint.protocol === 'valkeys:') endpoint.protocol = 'rediss:';
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
    if (endpoint.protocol !== 'rediss:' && !(local && endpoint.protocol === 'redis:')) return {};
    if (!endpoint.hostname || (endpoint.pathname && !/^\/\d*$/.test(endpoint.pathname)) || endpoint.hash || endpoint.search) return {};
    const ca = env.VALKEY_CA_CERT ? String(env.VALKEY_CA_CERT).replace(/\\n/g, '\n') : undefined;
    return { endpoint, ca };
  } catch { return {}; }
}

function connectionError(error) {
  // Never propagate a provider URL, credentials, command arguments or member
  // data through a native client's exception message.
  const allowed = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE']);
  const code = allowed.has(error?.code) ? error.code : 'REDIS_UNAVAILABLE';
  return Object.assign(new Error('Redis connection unavailable'), { code });
}

function replyError(error) {
  const message = String(error?.message || '');
  if (/^WRONGPASS|invalid password/i.test(message)) return 'WRONGPASS credential rejected';
  if (/^NOAUTH/i.test(message)) return 'Unauthorized Redis connection';
  if (/^NOPERM|^READONLY/i.test(message)) return 'NOPERM permission denied';
  if (/^OOM/i.test(message)) return 'Database storage capacity limit exceeded';
  if (/unknown command/i.test(message)) return 'Unsupported command';
  if (/wrong number of arguments|syntax error|invalid argument/i.test(message)) return 'Invalid argument';
  return 'Redis command failed';
}

function resultResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function commandBody(init) {
  let value;
  try { value = JSON.parse(init?.body); } catch { throw new TypeError('Invalid Redis request body'); }
  const valid = parts => Array.isArray(parts) && typeof parts[0] === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(parts[0]) && parts.every(part => typeof part === 'string' || (typeof part === 'number' && Number.isFinite(part)));
  const pipeline = Array.isArray(value) && Array.isArray(value[0]);
  const commands = pipeline ? value : [value];
  if (!commands.length || !commands.every(valid)) throw new TypeError('Invalid Redis command');
  return { pipeline, commands };
}

function abortable(promise, signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    // An already dispatched write may complete after an abort. We consume its
    // result and never replay it or retry it on a replacement connection.
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function newConnection(endpoint, ca, clientFactory) {
  let client, connecting, closed = false;
  const options = {
    lazyConnect: true,
    connectTimeout: 4000,
    commandTimeout: 4500,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
    reconnectOnError: () => false,
    autoResendUnfulfilledCommands: false,
    autoResubscribe: false,
    ...(endpoint.protocol === 'rediss:' ? { tls: { rejectUnauthorized: true, ...(ca ? { ca } : {}) } } : {})
  };

  async function ready() {
    if (closed) throw Object.assign(new Error('Redis storage closed'), { code: 'REDIS_CLOSED' });
    if (!client) {
      const factory = clientFactory || ((uri, settings) => new (require('ioredis'))(uri, settings));
      client = factory(endpoint.href, options);
      // Request promises report failures; prevent an idle socket error from
      // becoming an unhandled EventEmitter error containing connection details.
      client.on('error', () => {});
    }
    if (client.status === 'ready') return client;
    if (!connecting) connecting = Promise.resolve().then(() => client.connect()).then(() => client).finally(() => { connecting = null; });
    await connecting;
    if (closed) throw Object.assign(new Error('Redis storage closed'), { code: 'REDIS_CLOSED' });
    return client;
  }

  async function request(_endpoint, init = {}) {
    init.signal?.throwIfAborted();
    const { pipeline, commands } = commandBody(init);
    // Both connection and command are bounded even when no AbortSignal is used.
    let connection;
    try { connection = await abortable(ready(), init.signal); }
    catch (error) {
      if (init.signal?.aborted) throw init.signal.reason;
      if (error?.name === 'ReplyError') return resultResponse({ error: replyError(error) });
      throw connectionError(error);
    }
    init.signal?.throwIfAborted();
    try {
      if (pipeline) {
        const batch = connection.pipeline();
        for (const parts of commands) batch.call(...parts);
        const results = await abortable(batch.exec(), init.signal);
        if (!Array.isArray(results) || results.length !== commands.length) throw new Error('Invalid Redis pipeline response');
        return resultResponse(results.map(([error, result]) => error ? { error: replyError(error) } : { result }));
      }
      const result = await abortable(connection.call(...commands[0]), init.signal);
      return resultResponse({ result });
    } catch (error) {
      if (init.signal?.aborted) throw init.signal.reason;
      if (error?.name === 'ReplyError') return resultResponse({ error: replyError(error) });
      throw connectionError(error);
    }
  }

  function close() {
    if (closed) return;
    closed = true;
    client?.disconnect();
  }
  return { request, close };
}

function createRedisStorage(env = process.env, request = fetch, { clientFactory } = {}) {
  const backend = String(env.REDIS_BACKEND || 'rest').toLowerCase();
  if (backend === 'rest') {
    const { endpoint = null, token = null } = restSettings(env);
    return Object.freeze({ endpoint, token, configured: !!endpoint, backend, request, close() {} });
  }
  if (backend !== 'valkey') return Object.freeze({ endpoint: null, token: null, configured: false, backend, request, close() {} });
  const { endpoint = null, ca } = nativeSettings(env);
  if (!endpoint) return Object.freeze({ endpoint: null, token: null, configured: false, backend, request, close() {} });
  let shared = nativeConnections.get(env);
  if (!shared || shared.uri !== endpoint.href || shared.ca !== ca) {
    const connection = newConnection(endpoint, ca, clientFactory);
    shared = { uri: endpoint.href, ca, request: connection.request, close() {
      connection.close();
      if (nativeConnections.get(env) === shared) nativeConnections.delete(env);
    } };
    nativeConnections.set(env, shared);
  }
  return Object.freeze({ endpoint, token: 'native-transport', configured: true, backend, request: shared.request, close: shared.close });
}

module.exports = { createRedisStorage };
