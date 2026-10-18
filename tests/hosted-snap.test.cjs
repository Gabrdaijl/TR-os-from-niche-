const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createHostedSnap } = require('../hosted-snap.cjs');

const env = {
  BROWSERBASE_PROJECT_ID: 'project-private-test', BROWSERBASE_API_KEY: 'private-browserbase-api-key',
  KV_REST_API_URL: 'https://redis.invalid', KV_REST_API_TOKEN: 'private-redis-token'
};
class Response extends EventEmitter {
  constructor() { super(); this.status = null; this.chunks = []; this.destroyed = false; this.writableEnded = false; }
  writeHead(status, headers) { this.status = status; this.headers = headers; }
  write(data) { this.chunks.push(data); this.emit('chunk', JSON.parse(data)); return true; }
  end(data) { if (data) this.chunks.push(data); this.writableEnded = true; }
  disconnect() { this.destroyed = true; this.emit('close'); }
  get text() { return this.chunks.join(''); }
}
function harness(options = {}) {
  const calls = [], store = new Map(), sockets = [];
  const result = value => ({ ok: true, json: async () => value });
  async function fetchImpl(raw, init) {
    const url = new URL(raw), body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: url.href, init, body });
    if (url.hostname === 'redis.invalid') {
      assert.equal(init.headers.authorization, 'Bearer ' + env.KV_REST_API_TOKEN);
      assert.equal(body[0], 'EVAL');
      if (body[2] === 2) {
        const [, script, , lock, budget, owner, maximum] = body;
        assert.match(script, /redis.call\('SET',KEYS\[1\],ARGV\[1\],'EX',300\)/);
        assert.match(script, /redis.call\('INCR',KEYS\[2\]\)/);
        if (options.redisUnavailable) throw Error(env.KV_REST_API_TOKEN);
        if (store.has(lock)) return result({ result: [0, 0] });
        const used = store.get(budget) || 0;
        if (used >= maximum) return result({ result: [-1, used] });
        store.set(lock, owner); store.set(budget, used + 1);
        return result({ result: [1, used + 1] });
      }
      assert.match(body[1], /redis.call\('GET',KEYS\[1\]\)==ARGV\[1\]/);
      if (store.get(body[3]) === body[4]) store.delete(body[3]);
      return result({ result: 1 });
    }
    assert.equal(url.origin, 'https://api.browserbase.com');
    assert.equal(init.headers['X-BB-API-Key'], env.BROWSERBASE_API_KEY);
    if (url.pathname === '/v1/sessions') {
      if (options.create) await options.create();
      if (options.providerUnavailable) return { ok: false, json: async () => ({ error: env.BROWSERBASE_API_KEY }) };
      return result({ id: 'private-session-id', connectUrl: 'wss://connect.browserbase.com/?apiKey=' + env.BROWSERBASE_API_KEY, expiresAt: new Date(Date.now() + 240000).toISOString() });
    }
    if (url.pathname.endsWith('/debug')) return result({
      debuggerFullscreenUrl: 'https://www.browserbase.com/wrong-target',
      pages: [{ id: 'fresh-target', debuggerFullscreenUrl: options.liveUrl || 'https://www.browserbase.com/devtools/inspector.html?token=short-lived-capability' }]
    });
    assert.equal(url.pathname, '/v1/sessions/private-session-id');
    assert.deepEqual(body, { status: 'REQUEST_RELEASE' });
    return result({ status: 'COMPLETED' });
  }
  class Socket extends EventEmitter {
    constructor() {
      super(); sockets.push(this);
      if (options.socketConstructionFailure) throw Error(env.BROWSERBASE_API_KEY);
      queueMicrotask(() => this.emit('open'));
    }
    send(raw) {
      const command = JSON.parse(raw);
      assert.deepEqual(command, { id: 1, method: 'Target.createTarget', params: { url: 'https://web.snapchat.com/' } });
      options.commandStarted?.();
      if (options.cdpHang) return;
      queueMicrotask(() => this.emit('message', JSON.stringify(options.cdpError ? { id: command.id, error: { message: env.BROWSERBASE_API_KEY } } : { id: command.id, result: { targetId: 'fresh-target' } })));
    }
    terminate() { this.terminated = true; this.emit('close'); }
  }
  const app = () => createHostedSnap({ env, fetchImpl, WebSocketImpl: Socket });
  function start(instance = app()) {
    const req = new EventEmitter(); req.method = 'POST';
    const res = new Response();
    const ready = new Promise(resolve => res.on('chunk', event => { if (event.type === 'ready') resolve(event); }));
    const done = instance.handle(req, res);
    return { req, res, ready, done };
  }
  const creates = () => calls.filter(call => call.url === 'https://api.browserbase.com/v1/sessions');
  const releases = () => calls.filter(call => call.body?.status === 'REQUEST_RELEASE');
  return { app, start, calls, sockets, store, creates, releases };
}

test('hosted test owns a fresh private browser until disconnect, disables recordings and leaks no credentials', async () => {
  const h = harness(), run = h.start();
  const ready = await run.ready;
  assert.deepEqual(Object.keys(ready).sort(), ['expiresAt', 'type', 'url']);
  assert.equal(new URL(ready.url).searchParams.get('navbar'), 'false');
  assert.ok(Date.parse(ready.expiresAt) <= Date.now() + 240000);
  assert.equal(run.res.writableEnded, false);
  assert.equal(h.releases().length, 0);
  const create = h.creates()[0].body;
  assert.equal(create.timeout, 240);
  assert.deepEqual(create.browserSettings, {
    recordSession: false, logSession: false, solveCaptchas: false,
    advancedStealth: false, verified: false, ignoreCertificateErrors: false,
    viewport: { width: 1280, height: 800 }
  });
  assert.equal(Object.hasOwn(create, 'proxies'), false);
  assert.equal(Object.hasOwn(create, 'keepAlive'), false);
  assert.equal(Object.hasOwn(create.browserSettings, 'context'), false);
  assert.ok(h.calls.some(call => call.url.endsWith('/debug?expiresIn=240')));
  run.res.disconnect(); await run.done;
  assert.equal(h.releases().length, 1);
  assert.equal(h.sockets[0].terminated, true);
  assert.equal([...h.store.keys()].some(key => key.endsWith(':lock')), false);
  for (const secret of [env.BROWSERBASE_API_KEY, env.KV_REST_API_TOKEN, 'private-session-id', 'connectUrl', 'signingKey']) assert.equal(run.res.text.includes(secret), false);
});

test('global Redis reservation rejects another instance and never permits more than ten four-minute attempts', async () => {
  const h = harness(), first = h.start(h.app()); await first.ready;
  const other = h.start(h.app()); await other.done;
  assert.equal(other.res.status, 409); assert.equal(h.creates().length, 1);
  first.res.disconnect(); await first.done;
  for (let n = 1; n < 10; n++) {
    const run = h.start(h.app()); await run.ready;
    run.res.disconnect(); await run.done;
  }
  const exhausted = h.start(h.app()); await exhausted.done;
  assert.equal(exhausted.res.status, 429);
  assert.equal(h.creates().length, 10);
  assert.equal(h.creates().reduce((sum, call) => sum + call.body.timeout, 0), 2400);
});

test('failed provider starts consume reserved budget and return safe messages without secret upstream errors', async () => {
  const h = harness({ providerUnavailable: true }), run = h.start(); await run.done;
  assert.equal(run.res.status, 503);
  assert.equal(h.sockets.length, 0);
  assert.equal(h.releases().length, 0);
  assert.equal([...h.store.entries()].find(([key]) => key.endsWith(':starts'))[1], 1);
  assert.equal([...h.store.keys()].some(key => key.endsWith(':lock')), false);
  assert.equal(run.res.text.includes(env.BROWSERBASE_API_KEY), false);
});

test('unsafe and key-bearing live URLs are rejected and sessions are released', async () => {
  for (const liveUrl of ['https://attacker.invalid/live', 'javascript:alert(1)', 'https://www.browserbase.com/live?ws=' + encodeURIComponent('wss://connect.browserbase.com/?apiKey=' + env.BROWSERBASE_API_KEY)]) {
    const h = harness({ liveUrl }), run = h.start(); await run.done;
    assert.equal(run.res.status, 503);
    assert.equal(h.releases().length, 1);
    assert.equal(h.sockets[0].terminated, true);
    assert.equal(run.res.text.includes(liveUrl), false);
    assert.equal(run.res.text.includes(env.BROWSERBASE_API_KEY), false);
  }
});

test('CDP failure and constructor failure release the reserved session', async () => {
  for (const options of [{ cdpError: true }, { socketConstructionFailure: true }]) {
    const h = harness(options), run = h.start(); await run.done;
    assert.equal(run.res.status, 503);
    assert.equal(h.releases().length, 1);
    assert.equal([...h.store.keys()].some(key => key.endsWith(':lock')), false);
    assert.equal(run.res.text.includes(env.BROWSERBASE_API_KEY), false);
  }
});

test('disconnect during setup still releases a created session and clears global ownership', async () => {
  let resume, creationStarted;
  const started = new Promise(resolve => { creationStarted = resolve; });
  const h = harness({ create: () => { creationStarted(); return new Promise(resolve => { resume = resolve; }); } });
  const run = h.start(); await started;
  run.res.disconnect(); resume(); await run.done;
  assert.equal(h.releases().length, 1);
  assert.equal(h.sockets.length, 0);
  assert.equal([...h.store.keys()].some(key => key.endsWith(':lock')), false);
});

test('disconnect while waiting for CDP cancels the pending command and releases immediately', async () => {
  let commandStarted;
  const started = new Promise(resolve => { commandStarted = resolve; });
  const h = harness({ cdpHang: true, commandStarted }), run = h.start();
  await started; run.res.disconnect(); await run.done;
  assert.equal(h.releases().length, 1);
  assert.equal(h.sockets[0].terminated, true);
  assert.equal([...h.store.keys()].some(key => key.endsWith(':lock')), false);
});

test('session deadline terminates CDP and releases quota without requesting a paid keep-alive', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(), run = h.start(); await run.ready;
  t.mock.timers.tick(240000); await run.done;
  assert.equal(run.res.writableEnded, true);
  assert.equal(h.releases().length, 1);
  assert.equal(h.sockets[0].terminated, true);
  assert.match(run.res.text, /ended/);
});

test('missing credentials, unavailable Redis and wrong method cannot start a browser', async () => {
  let requests = 0;
  const app = createHostedSnap({ env: {}, fetchImpl: async () => { requests++; throw Error(); } });
  const req = new EventEmitter(), res = new Response(); req.method = 'POST';
  await app.handle(req, res); assert.equal(res.status, 503); assert.equal(requests, 0);
  req.method = 'GET'; const wrong = new Response(); await app.handle(req, wrong); assert.equal(wrong.status, 405);
  const h = harness({ redisUnavailable: true }), failed = h.start(); await failed.done;
  assert.equal(failed.res.status, 503); assert.equal(h.creates().length, 0);
  assert.equal(failed.res.text.includes(env.KV_REST_API_TOKEN), false);
});

test('a second device receives a new browser and live view after the first disconnects, without persistent auth context', async () => {
  let owner = null, starts = 0;
  const creations = [], releases = [], sockets = [];
  const result = value => ({ ok: true, json: async () => value });
  async function fetchImpl(raw, init) {
    const url = new URL(raw), body = init.body ? JSON.parse(init.body) : null;
    if (url.hostname === 'redis.invalid') {
      if (body[2] === 2) {
        if (owner) return result({ result: [0, 0] });
        owner = body[5]; return result({ result: [1, ++starts] });
      }
      if (owner === body[4]) owner = null;
      return result({ result: 1 });
    }
    if (url.pathname === '/v1/sessions') {
      const id = 'distinct-session-' + (creations.length + 1);
      creations.push({ id, body });
      return result({ id, connectUrl: 'wss://connect.browserbase.com/?sessionId=' + id, expiresAt: new Date(Date.now() + 240000).toISOString() });
    }
    const session = url.pathname.split('/')[3];
    if (url.pathname.endsWith('/debug')) return result({ pages: [{
      id: session + '-target',
      debuggerFullscreenUrl: 'https://www.browserbase.com/devtools/inspector.html?token=unique-capability-' + creations.findIndex(item => item.id === session)
    }] });
    assert.deepEqual(body, { status: 'REQUEST_RELEASE' });
    releases.push(session); return result({ status: 'COMPLETED' });
  }
  class DeviceSocket extends EventEmitter {
    constructor(url) {
      super(); this.session = new URL(url).searchParams.get('sessionId');
      sockets.push(this); queueMicrotask(() => this.emit('open'));
    }
    send(raw) {
      const command = JSON.parse(raw);
      assert.deepEqual(command.params, { url: 'https://web.snapchat.com/' });
      queueMicrotask(() => this.emit('message', JSON.stringify({ id: command.id, result: { targetId: this.session + '-target' } })));
    }
    terminate() { this.terminated = true; this.emit('close'); }
  }
  function device() {
    // Independent app instances model requests from different devices reaching separate Vercel instances.
    const app = createHostedSnap({ env, fetchImpl, WebSocketImpl: DeviceSocket });
    const req = new EventEmitter(), res = new Response(); req.method = 'POST';
    const ready = new Promise(resolve => res.on('chunk', event => { if (event.type === 'ready') resolve(event); }));
    return { res, ready, done: app.handle(req, res) };
  }
  const first = device(), firstReady = await first.ready;
  first.res.disconnect(); await first.done;
  assert.deepEqual(releases, ['distinct-session-1']);
  const second = device(), secondReady = await second.ready;
  assert.equal(creations.length, 2);
  assert.notEqual(creations[0].id, creations[1].id);
  assert.equal(sockets.length, 2);
  assert.equal(sockets[0].terminated, true);
  assert.notEqual(sockets[0], sockets[1]);
  assert.equal(sockets[1].session, creations[1].id);
  assert.notEqual(secondReady.url, firstReady.url);
  assert.equal(second.res.text.includes(firstReady.url), false);
  for (const { body } of creations) {
    assert.equal(Object.hasOwn(body.browserSettings, 'context'), false);
    assert.equal(Object.hasOwn(body, 'contextId'), false);
    assert.equal(Object.hasOwn(body, 'keepAlive'), false);
  }
  second.res.disconnect(); await second.done;
  assert.deepEqual(releases, ['distinct-session-1', 'distinct-session-2']);
});
