'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createRedisStorage } = require('../redis-storage.cjs');

function clientFactory(record, { replies = [], pipelineReplies = [] } = {}) {
  return (url, options) => {
    const client = new EventEmitter();
    const entry = { url, options, connectCalls: 0, disconnectCalls: 0, commands: [], pipelines: [] };
    record.push(entry);
    client.status = 'wait';
    client.connect = async () => {
      entry.connectCalls++;
      client.status = 'ready';
      client.emit('ready');
    };
    client.call = async (...parts) => {
      entry.commands.push(parts);
      const reply = replies.length ? replies.shift() : 'PONG';
      if (reply instanceof Error) throw reply;
      return reply;
    };
    client.pipeline = () => {
      const parts = [];
      const pipeline = {
        call(...command) { parts.push(command); return pipeline; },
        async exec() {
          entry.pipelines.push(parts);
          return pipelineReplies.length ? pipelineReplies.shift() : parts.map(() => [null, 'OK']);
        }
      };
      return pipeline;
    };
    client.disconnect = () => { entry.disconnectCalls++; client.status = 'end'; };
    entry.client = client;
    return client;
  };
}

const noHttp = () => assert.fail('Native Valkey commands must not invoke the HTTP transport');
const command = parts => ({ method: 'POST', body: JSON.stringify(parts) });
const nativeEnv = () => ({ REDIS_BACKEND: 'valkey', VALKEY_URL: 'valkeys://default:test-secret@valkey.example:12345' });

test('REST remains the default even when a native REDIS_URL exists', async () => {
  const calls = [];
  const request = async (...args) => { calls.push(args); return { ok: true }; };
  const storage = createRedisStorage({
    KV_REST_API_URL: 'https://redis.example', KV_REST_API_TOKEN: 'rest-secret',
    REDIS_URL: 'rediss://default:native-secret@native.example:12345'
  }, request, { clientFactory: () => assert.fail('Default storage must not create a native client') });
  assert.equal(storage.backend, 'rest');
  assert.equal(storage.configured, true);
  assert.equal(storage.endpoint.hostname, 'redis.example');
  assert.equal(storage.token, 'rest-secret');
  const init = command(['PING']);
  await storage.request(storage.endpoint, init);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], init);
  await storage.close();
});

test('REST URL and token aliases retain Upstash precedence', () => {
  const storage = createRedisStorage({
    UPSTASH_REDIS_REST_URL: 'https://upstash.example', UPSTASH_REDIS_REST_TOKEN: 'upstash-secret',
    KV_REST_API_URL: 'https://kv.example', KV_REST_API_TOKEN: 'kv-secret'
  }, noHttp);
  assert.equal(storage.endpoint.hostname, 'upstash.example');
  assert.equal(storage.token, 'upstash-secret');
});

test('native Valkey normalizes TLS URL and opens only on the first request', async () => {
  const records = [];
  const storage = createRedisStorage(nativeEnv(), noHttp, { clientFactory: clientFactory(records) });
  assert.equal(storage.backend, 'valkey');
  assert.equal(storage.configured, true);
  assert.equal(storage.endpoint.hostname, 'valkey.example');
  assert.equal(records.length, 0, 'Constructing modules must not open a database connection');
  const response = await storage.request(storage.endpoint, command(['PING']));
  assert.equal(response.ok, true);
  assert.deepEqual(await response.json(), { result: 'PONG' });
  assert.equal(records.length, 1);
  assert.match(records[0].url, /^rediss:\/\//);
  assert.equal(records[0].connectCalls, 1);
  assert.deepEqual(records[0].commands, [['PING']]);
  assert.equal(records[0].options.enableOfflineQueue, false);
  assert.equal(records[0].options.autoResendUnfulfilledCommands, false);
  assert.equal(records[0].options.maxRetriesPerRequest, 0);
  assert.ok(records[0].options.commandTimeout > 0);
  assert.equal(records[0].options.tls?.rejectUnauthorized, true);
  await storage.close();
});

test('native pipeline preserves command order and per-command errors', async () => {
  const records = [];
  const storage = createRedisStorage(nativeEnv(), noHttp, { clientFactory: clientFactory(records, {
    pipelineReplies: [[[null, 3], [new Error('WRONGTYPE private-key-and-member-data'), null], [null, null]]]
  }) });
  const endpoint = new URL(storage.endpoint);
  endpoint.pathname = '/pipeline';
  const response = await storage.request(endpoint, command([['SCARD', 'members'], ['GET', 'members'], ['GET', 'missing']]));
  assert.equal(response.ok, true);
  const values = await response.json();
  assert.deepEqual(values[0], { result: 3 });
  assert.equal(typeof values[1].error, 'string');
  assert.ok(values[1].error.length > 0);
  assert.doesNotMatch(values[1].error, /private-key-and-member-data/);
  assert.deepEqual(values[2], { result: null });
  assert.deepEqual(records[0].pipelines, [[['SCARD', 'members'], ['GET', 'members'], ['GET', 'missing']]]);
  await storage.close();
});

test('native clients are shared for one app env and isolated across app envs', async () => {
  const records = [];
  const factory = clientFactory(records);
  const env = nativeEnv();
  const first = createRedisStorage(env, noHttp, { clientFactory: factory });
  const second = createRedisStorage(env, noHttp, { clientFactory: factory });
  const separate = createRedisStorage(nativeEnv(), noHttp, { clientFactory: factory });
  await Promise.all([
    first.request(first.endpoint, command(['PING'])),
    second.request(second.endpoint, command(['PING'])),
    separate.request(separate.endpoint, command(['PING']))
  ]);
  assert.equal(records.length, 2);
  assert.equal(records[0].connectCalls, 1);
  assert.equal(records[0].commands.length, 2);
  assert.equal(records[1].commands.length, 1);
  await first.close();
  await second.close();
  await first.close();
  assert.equal(records[0].disconnectCalls, 1);
  await separate.close();
  assert.equal(records[1].disconnectCalls, 1);
});

test('explicit native mode fails closed on missing, malformed, or unencrypted public URLs', () => {
  for (const url of ['', 'invalid-url', 'https://valkey.example', 'redis://default:secret@valkey.example:12345']) {
    const storage = createRedisStorage({
      REDIS_BACKEND: 'valkey', VALKEY_URL: url,
      KV_REST_API_URL: 'https://rest.example', KV_REST_API_TOKEN: 'rest-secret'
    }, noHttp, { clientFactory: () => assert.fail('Invalid native configuration must not create a connection') });
    assert.equal(storage.configured, false, url);
    assert.equal(storage.endpoint, null, url);
  }
});

test('REDIS_URL is accepted only after native mode was explicitly selected', async () => {
  const records = [];
  const storage = createRedisStorage({ REDIS_BACKEND: 'valkey', REDIS_URL: 'rediss://default:test-secret@native.example:12345' }, noHttp, {
    clientFactory: clientFactory(records)
  });
  assert.equal(storage.configured, true);
  await storage.request(storage.endpoint, command(['PING']));
  assert.equal(records.length, 1);
  await storage.close();
});

test('closing an unused native adapter stays lazy', async () => {
  const storage = createRedisStorage(nativeEnv(), noHttp, { clientFactory: () => assert.fail('Close must not create a connection') });
  await storage.close();
  await storage.close();
});

test('pre-aborted native requests never connect or send commands', async () => {
  const records = [];
  const storage = createRedisStorage(nativeEnv(), noHttp, { clientFactory: clientFactory(records) });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(storage.request(storage.endpoint, { ...command(['SET', 'key', 'value']), signal: controller.signal }), {
    name: 'AbortError'
  });
  assert.equal(records.length, 0);
  await storage.close();
});

test('aborting an in-flight write never replays it', async () => {
  const records = [];
  let finishWrite;
  let markDispatched;
  const dispatched = new Promise(resolve => { markDispatched = resolve; });
  const factory = clientFactory(records);
  const storage = createRedisStorage(nativeEnv(), noHttp, { clientFactory: (url, options) => {
    const client = factory(url, options);
    client.call = (...parts) => {
      records[0].commands.push(parts);
      markDispatched();
      return new Promise(resolve => { finishWrite = resolve; });
    };
    return client;
  } });
  const controller = new AbortController();
  const response = storage.request(storage.endpoint, { ...command(['INCR', 'counter']), signal: controller.signal });
  await dispatched;
  controller.abort();
  await assert.rejects(response, { name: 'AbortError' });
  assert.deepEqual(records[0].commands, [['INCR', 'counter']]);
  finishWrite(1);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(records[0].commands, [['INCR', 'counter']]);
  await storage.close();
});

test('native command rejection reports a safe authentication category', async () => {
  const records = [];
  const rejected = new Error('WRONGPASS invalid username-password pair for test-secret and private-member');
  rejected.name = 'ReplyError';
  const storage = createRedisStorage(nativeEnv(), noHttp, { clientFactory: clientFactory(records, { replies: [rejected] }) });
  const response = await storage.request(storage.endpoint, command(['PING']));
  const payload = await response.json();
  assert.match(payload.error, /WRONGPASS|credential rejected/);
  assert.doesNotMatch(payload.error, /test-secret|private-member|valkey\.example/);
  assert.equal(records[0].commands.length, 1);
  await storage.close();
});

test('custom Aiven CA keeps certificate verification enabled', async () => {
  const records = [];
  const storage = createRedisStorage({ ...nativeEnv(), VALKEY_CA_CERT: 'test-first-line\\ntest-second-line' }, noHttp, {
    clientFactory: clientFactory(records)
  });
  await storage.request(storage.endpoint, command(['PING']));
  assert.equal(records[0].options.tls.rejectUnauthorized, true);
  assert.equal(records[0].options.tls.ca, 'test-first-line\ntest-second-line');
  await storage.close();
});

test('closed shared storage can be replaced by a fresh app instance', async () => {
  const records = [], env = nativeEnv();
  const options = { clientFactory: clientFactory(records) };
  const first = createRedisStorage(env, noHttp, options);
  await first.request(first.endpoint, command(['PING']));
  first.close();
  const second = createRedisStorage(env, noHttp, options);
  await second.request(second.endpoint, command(['PING']));
  assert.equal(records.length, 2);
  second.close();
});

test('all storage modules use the shared native connection and traffic keeps its pipeline', async () => {
  const records = [], env = { ...nativeEnv(), VALKEY_URL: 'rediss://default:test@native.example:1234/0', VAPID_PUBLIC_KEY: 'test', VAPID_PRIVATE_KEY: 'test' };
  const storage = createRedisStorage(env, noHttp, { clientFactory: clientFactory(records, {
    replies: ['PONG', null, [0, 0], 0, [], [], []],
    pipelineReplies: [[[null, Array(10).fill(0)], [null, 0], [null, 0]]]
  }) });
  const { createMemberships } = require('../memberships.cjs');
  const { createPresence } = require('../presence.cjs');
  const { createTraffic } = require('../traffic.cjs');
  const { createModeration } = require('../moderation.cjs');
  const { createReports } = require('../reports.cjs');
  const { createPushNotifications } = require('../push.cjs');
  assert.equal(await createMemberships(env, noHttp).health(), 'ready');
  assert.equal((await createPresence(env, () => 0, noHttp).snapshot()).presence.source, 'redis');
  assert.equal(await createModeration(env, noHttp).isBanned('a'.repeat(64)), false);
  assert.equal((await createModeration(env, noHttp).list()).source, 'redis');
  await createReports(env, noHttp).list();
  const fakePush = { setVapidDetails() {} };
  assert.equal((await createPushNotifications(env, noHttp, fakePush).notifyAdmins('test', 'test')).ok, true);
  const snapshot = await createTraffic(env, noHttp).snapshot();
  assert.equal(snapshot.source, 'redis');
  assert.deepEqual(records[0].pipelines[0].map(parts => parts[0]), ['EVAL_RO', 'PFCOUNT', 'PFCOUNT']);
  assert.equal(records[0].url.endsWith('/0'), true);
  assert.equal(records.length, 1);
  storage.close();
});

test('real ioredis transport serves app readiness through a loopback RESP server', async () => {
  const net = require('node:net');
  const sockets = new Set();
  const observed = [];
  const encode = value => value === null ? '$-1\r\n' : Array.isArray(value)
    ? '*' + value.length + '\r\n' + value.map(encode).join('')
    : typeof value === 'number' ? ':' + value + '\r\n'
    : '$' + Buffer.byteLength(value) + '\r\n' + value + '\r\n';
  const wire = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length) {
        let end = buffer.indexOf('\r\n');
        if (end < 0) break;
        const count = Number(buffer.subarray(1, end).toString());
        let offset = end + 2, parts = [];
        for (let index = 0; index < count; index++) {
          end = buffer.indexOf('\r\n', offset);
          if (end < 0) break;
          const length = Number(buffer.subarray(offset + 1, end).toString());
          if (buffer.length < end + 2 + length + 2) break;
          parts.push(buffer.subarray(end + 2, end + 2 + length).toString());
          offset = end + 2 + length + 2;
        }
        if (parts.length !== count) break;
        buffer = buffer.subarray(offset);
        observed.push(parts[0].toUpperCase());
        const name = parts[0].toUpperCase();
        socket.write(encode(name === 'PING' ? 'PONG' : name === 'INFO' ? 'redis_version:7.2.4\r\nloading:0\r\n' : name === 'EVAL_RO' ? null : 'OK'));
      }
    });
  });
  await new Promise(resolve => wire.listen(0, '127.0.0.1', resolve));
  const env = { REDIS_BACKEND: 'valkey', VALKEY_URL: 'redis://127.0.0.1:' + wire.address().port, ADMIN_PASSWORD: 'test-admin-password' };
  let app;
  try {
    app = require('../server.cjs').createApp({ env });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const response = await fetch('http://127.0.0.1:' + app.server.address().port + '/api/ready');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).services.membership, 'ready');
    assert.ok(observed.includes('PING'));
    assert.ok(observed.includes('EVAL_RO'));
  } finally {
    if (app) await app.close();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => wire.close(resolve));
  }
});
