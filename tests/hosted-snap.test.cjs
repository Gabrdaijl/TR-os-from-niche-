const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createHostedSnap } = require('../hosted-snap.cjs');

const env = {
  BROWSERBASE_PROJECT_ID: 'project-private-test', BROWSERBASE_API_KEY: 'private-browserbase-api-key',
  KV_REST_API_URL: 'https://redis.invalid', KV_REST_API_TOKEN: 'private-redis-token'
};
class Response extends EventEmitter {
  constructor() { super(); this.status = null; this.headers = {}; this.chunks = []; this.destroyed = false; this.writableEnded = false; }
  setHeader(name, value) { this.headers[name.toLowerCase()] = value; }
  writeHead(status, headers) { this.status = status; this.headers = { ...this.headers, ...headers }; }
  write(data) { this.chunks.push(data); this.emit('chunk', JSON.parse(data)); return true; }
  end(data) { if (data) this.chunks.push(data); this.writableEnded = true; }
  disconnect() { this.destroyed = true; this.emit('close'); }
  get text() { return this.chunks.join(''); }
}
function harness(options = {}) {
  const calls = [], store = new Map(), sockets = [], contextsCreated = [], contextsDeleted = [], expiries = new Map();
  let clock = 0;
  function expire(key) { if (expiries.has(key) && expiries.get(key) <= clock) { store.delete(key); expiries.delete(key); } }
  const result = value => ({ ok: true, json: async () => value });
  async function fetchImpl(raw, init) {
    const url = new URL(raw), body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: url.href, init, body });
    if (url.hostname === 'redis.invalid') {
      assert.equal(init.headers.authorization, 'Bearer ' + env.KV_REST_API_TOKEN);
      if (body[0] === 'GET') { expire(body[1]); return result({ result: store.get(body[1]) ?? null }); }
      if (body[0] === 'SET') {
        expire(body[1]);
        if (body.includes('NX') && store.has(body[1])) return result({ result: null });
        const ex = body.indexOf('EX');
        if (ex >= 0) {
          assert.ok([8, 300].includes(body[ex + 1]));
          expiries.set(body[1], clock + body[ex + 1] * 1000);
        } else {
          assert.match(body[1], /^tros:snap:profile:v1:/);
          if (options.profileMapUnavailable) throw Error(env.KV_REST_API_TOKEN);
          expiries.delete(body[1]);
        }
        store.set(body[1], body[2]); return result({ result: 'OK' });
      }
      if (body[0] === 'DEL') return result({ result: body.slice(1).reduce((n, key) => n + Number(store.delete(key)), 0) });
      assert.equal(body[0], 'EVAL');
      if (body[2] === 2 || body[2] === 3) {
        const [, script, keyCount, lock, budget] = body;
        const owner = body[3 + keyCount], maximum = body[4 + keyCount];
        assert.match(script, /redis.call\('SET',KEYS\[1\],ARGV\[1\],'EX',300\)/);
        assert.match(script, /redis.call\('INCR',KEYS\[2\]\)/);
        if (options.redisUnavailable) throw Error(env.KV_REST_API_TOKEN);
        if (keyCount === 3) { expire(body[5]); if (store.has(body[5])) return result({ result: [-2, 0] }); }
        expire(lock);
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
    if (url.pathname === '/v1/contexts') {
      assert.deepEqual(body, { projectId: env.BROWSERBASE_PROJECT_ID });
      if (options.contextUnavailable) return { ok: false, json: async () => ({ error: env.BROWSERBASE_API_KEY }) };
      const id = options.invalidContextId || 'private-context-' + (contextsCreated.length + 1);
      contextsCreated.push(id); return result({ id });
    }
    if (url.pathname.startsWith('/v1/contexts/')) {
      assert.equal(init.method, 'DELETE');
      if (options.deleteContextUnavailable) return { ok: false, json: async () => ({ error: env.BROWSERBASE_API_KEY }) };
      contextsDeleted.push(url.pathname.split('/').pop());
      return { ok: true, status: 204, json: async () => { throw Error('No JSON in a 204 response'); } };
    }
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
    if (options.rejectReleaseAfterTerminate && sockets.at(-1)?.terminated) return { ok: false, json: async () => ({ error: 'Session already closed' }) };
    if (options.releaseUnavailable) return { ok: false, json: async () => ({ error: env.BROWSERBASE_API_KEY }) };
    if (options.closeOnRelease) for (const socket of sockets) socket.emit('close');
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
  const app = () => createHostedSnap({ env: { ...env, ...options.env }, fetchImpl, WebSocketImpl: Socket });
  function start(instance = app(), token, headers = {}) {
    const req = new EventEmitter(); req.method = 'POST';
    req.headers = { ...(token ? { 'x-tros-snap-stop': token } : {}), ...headers };
    const res = new Response();
    const ready = new Promise(resolve => res.on('chunk', event => { if (event.type === 'ready') resolve(event); }));
    const done = instance.handle(req, res);
    return { req, res, ready, done };
  }
  const creates = () => calls.filter(call => call.url === 'https://api.browserbase.com/v1/sessions');
  const releases = () => calls.filter(call => call.body?.status === 'REQUEST_RELEASE');
  return { app, start, calls, sockets, store, creates, releases, contextsCreated, contextsDeleted, advance: ms => { clock += ms; for (const key of expiries.keys()) expire(key); } };
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
  const metadata = new Map();
  const creations = [], releases = [], sockets = [];
  const result = value => ({ ok: true, json: async () => value });
  async function fetchImpl(raw, init) {
    const url = new URL(raw), body = init.body ? JSON.parse(init.body) : null;
    if (url.hostname === 'redis.invalid') {
      if (body[0] === 'GET') return result({ result: metadata.get(body[1]) ?? null });
      if (body[0] === 'SET') { metadata.set(body[1], body[2]); return result({ result: 'OK' }); }
      if (body[0] === 'DEL') { for (const key of body.slice(1)) metadata.delete(key); return result({ result: 1 }); }
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

async function stopFrom(instance, token) {
  const req = new EventEmitter(), res = new Response();
  req.method = 'POST'; req.headers = { 'x-tros-snap-stop': token };
  await instance.stop(req, res);
  return res;
}

test('explicit stop from another server instance releases only the matching owner and ends its stream', async () => {
  const h = harness({ closeOnRelease: true }), token = 'a'.repeat(64);
  const run = h.start(h.app(), token); await run.ready;
  const unrelated = await stopFrom(h.app(), 'b'.repeat(64));
  assert.equal(unrelated.status, 202); assert.equal(h.releases().length, 0);
  assert.equal(run.res.writableEnded, false);
  const stopped = await stopFrom(h.app(), token); await run.done;
  assert.equal(stopped.status, 200);
  assert.deepEqual(JSON.parse(stopped.text), { ok: true, pending: false });
  assert.equal(stopped.text.includes('private-session-id'), false);
  assert.equal(h.sockets[0].terminated, true);
  assert.equal(run.res.writableEnded, true);
  assert.equal([...h.store.keys()].some(key => key.endsWith(':lock')), false);
  assert.equal([...h.store.keys()].some(key => key.endsWith(':session')), false);
  assert.ok(h.releases().length >= 1);
  const next = h.start(h.app(), 'c'.repeat(64)); await next.ready;
  next.res.disconnect(); await next.done;
  assert.equal(h.creates().length, 2);
});

test('stop racing session creation retains cancellation until mapping exists and never emits a live view', async () => {
  let resume, creationStarted;
  const started = new Promise(resolve => { creationStarted = resolve; });
  const h = harness({ create: () => { creationStarted(); return new Promise(resolve => { resume = resolve; }); } });
  const token = 'd'.repeat(64), run = h.start(h.app(), token); await started;
  const stopped = await stopFrom(h.app(), token);
  assert.equal(stopped.status, 202);
  assert.equal(h.releases().length, 0);
  assert.equal([...h.store.keys()].some(key => key.endsWith(':cancel')), true);
  resume(); await run.done;
  assert.equal(run.res.text.includes('"type":"ready"'), false);
  assert.equal(h.sockets.length, 0);
  assert.equal(h.releases().length, 1);
  assert.equal([...h.store.keys()].some(key => /:(lock|session|cancel)$/.test(key)), false);
});

test('failed explicit release preserves lock and metadata for retry instead of permitting overlapping sessions', async () => {
  const h = harness({ releaseUnavailable: true }), token = 'e'.repeat(64);
  const run = h.start(h.app(), token); await run.ready;
  const stopped = await stopFrom(h.app(), token);
  assert.equal(stopped.status, 503);
  assert.equal(stopped.text.includes(env.BROWSERBASE_API_KEY), false);
  assert.equal([...h.store.keys()].some(key => key.endsWith(':lock')), true);
  assert.equal([...h.store.keys()].some(key => key.endsWith(':session')), true);
  const blocked = h.start(h.app()); await blocked.done;
  assert.equal(blocked.res.status, 409);
  run.res.disconnect(); await run.done;
  assert.equal([...h.store.keys()].some(key => key.endsWith(':lock')), true);
});

test('explicit stop requires a valid random capability and cannot disclose provider identifiers', async () => {
  const h = harness();
  for (const token of [undefined, '', 'a', 'g'.repeat(64), ['a'.repeat(64)]]) {
    const stopped = await stopFrom(h.app(), token);
    assert.equal(stopped.status, 400);
  }
  assert.equal(h.calls.length, 0);
});

async function forgetFrom(instance, cookie) {
  const req = new EventEmitter(), res = new Response();
  req.method = 'POST'; req.headers = cookie ? { cookie } : {};
  await instance.forget(req, res); return res;
}

test('remembering reuses only the same device profile across instances and cooldown consumes no extra starts', async () => {
  const h = harness({ env: { VERCEL: '1' } });
  const first = h.start(h.app(), '1'.repeat(64), { 'x-tros-snap-remember': '1' }); await first.ready;
  const setCookie = first.res.headers['set-cookie'], cookie = setCookie.split(';')[0];
  assert.match(cookie, /^__Host-tros-snap-device=[a-f0-9]{64}$/);
  assert.match(setCookie, /; Path=\/; HttpOnly; SameSite=Strict; Max-Age=31536000; Secure$/);
  assert.equal(setCookie.includes('Domain='), false);
  assert.deepEqual(h.creates()[0].body.browserSettings.context, { id: 'private-context-1', persist: true });
  first.res.disconnect(); await first.done;
  const blocked = h.start(h.app(), '2'.repeat(64), { cookie, 'x-tros-snap-remember': '1' }); await blocked.done;
  assert.equal(blocked.res.status, 409); assert.match(blocked.res.text, /Profilen sparas/);
  assert.equal(h.creates().length, 1);
  assert.equal([...h.store.entries()].find(([key]) => key.endsWith(':starts'))[1], 1);
  h.advance(8001);
  const returning = h.start(h.app(), '3'.repeat(64), { cookie, 'x-tros-snap-remember': '1' }); await returning.ready;
  assert.equal(h.contextsCreated.length, 1);
  assert.deepEqual(h.creates()[1].body.browserSettings.context, { id: 'private-context-1', persist: true });
  returning.res.disconnect(); await returning.done;
  const other = h.start(h.app(), '4'.repeat(64), { 'x-tros-snap-remember': '1' }); await other.ready;
  const otherCookie = other.res.headers['set-cookie'].split(';')[0];
  assert.notEqual(otherCookie, cookie);
  assert.deepEqual(h.contextsCreated, ['private-context-1', 'private-context-2']);
  assert.deepEqual(h.creates()[2].body.browserSettings.context, { id: 'private-context-2', persist: true });
  other.res.disconnect(); await other.done;
  // Existing profile cookies are ignored unless the current start explicitly opts in.
  const fresh = h.start(h.app(), '5'.repeat(64), { cookie }); await fresh.ready;
  assert.equal(Object.hasOwn(h.creates()[3].body.browserSettings, 'context'), false);
  assert.equal(fresh.res.headers['set-cookie'], undefined);
  fresh.res.disconnect(); await fresh.done;
  const mappings = [...h.store.entries()].filter(([key]) => key.startsWith('tros:snap:profile:v1:') && !key.endsWith(':cooldown'));
  assert.deepEqual(mappings.map(([, id]) => id).sort(), ['private-context-1', 'private-context-2']);
  for (const [key] of mappings) {
    assert.equal(key.includes(cookie.split('=')[1]), false);
    assert.equal(key.includes(otherCookie.split('=')[1]), false);
  }
  for (const run of [first, returning, other, fresh]) {
    assert.equal(run.res.text.includes('private-context-'), false);
    assert.equal(run.res.text.includes(cookie), false);
    assert.equal(run.res.text.includes(env.BROWSERBASE_API_KEY), false);
  }
});

test('cross-instance explicit stop applies the remembered profile cooldown before permitting another start', async () => {
  const h = harness({ closeOnRelease: true }), token = '6'.repeat(64);
  const first = h.start(h.app(), token, { 'x-tros-snap-remember': '1' }); await first.ready;
  const cookie = first.res.headers['set-cookie'].split(';')[0];
  await stopFrom(h.app(), token); await first.done;
  const before = [...h.store.entries()].find(([key]) => key.endsWith(':starts'))[1];
  const returning = h.start(h.app(), '7'.repeat(64), { cookie, 'x-tros-snap-remember': '1' }); await returning.done;
  assert.equal(returning.res.status, 409);
  assert.equal([...h.store.entries()].find(([key]) => key.endsWith(':starts'))[1], before);
  assert.equal(h.creates().length, 1);
});

test('remembering validates device cookies and provider context IDs without exposing them or silently paying', async () => {
  for (const cookie of ['__Host-tros-snap-device=bad', '__Host-tros-snap-device=' + 'a'.repeat(64) + '; __Host-tros-snap-device=' + 'b'.repeat(64)]) {
    const h = harness({ env: { VERCEL: '1' } });
    const run = h.start(h.app(), undefined, { cookie, 'x-tros-snap-remember': '1' }); await run.done;
    assert.equal(run.res.status, 400); assert.equal(h.calls.length, 0);
  }
  for (const options of [{ contextUnavailable: true }, { invalidContextId: '../../invalid?' + env.BROWSERBASE_API_KEY }]) {
    const h = harness(options), run = h.start(h.app(), undefined, { 'x-tros-snap-remember': '1' }); await run.done;
    assert.equal(run.res.status, 503);
    assert.equal(h.creates().length, 0);
    assert.equal(run.res.headers['set-cookie'], undefined);
    assert.equal(run.res.text.includes(env.BROWSERBASE_API_KEY), false);
    assert.equal([...h.store.keys()].some(key => key.endsWith(':lock')), false);
    assert.match(run.res.text, /Ingen betalplan aktiveras/);
  }
  // A sibling-domain legacy cookie cannot select the production host-only profile.
  const h = harness({ env: { VERCEL: '1' } }), planted = 'a'.repeat(64);
  const run = h.start(h.app(), undefined, { cookie: 'tros_snap_device=' + planted, 'x-tros-snap-remember': '1' }); await run.ready;
  assert.notEqual(run.res.headers['set-cookie'].split(';')[0], '__Host-tros-snap-device=' + planted);
  run.res.disconnect(); await run.done;
});

test('forget refuses an active browser, then deletes only that device profile and expires its secure cookie', async () => {
  const h = harness({ env: { VERCEL: '1' } });
  const run = h.start(h.app(), '8'.repeat(64), { 'x-tros-snap-remember': '1' }); await run.ready;
  const cookie = run.res.headers['set-cookie'].split(';')[0];
  const active = await forgetFrom(h.app(), cookie);
  assert.equal(active.status, 409); assert.equal(h.contextsDeleted.length, 0);
  assert.equal(active.headers['set-cookie'], undefined);
  run.res.disconnect(); await run.done;
  const forgotten = await forgetFrom(h.app(), cookie);
  assert.equal(forgotten.status, 200);
  assert.deepEqual(JSON.parse(forgotten.text), { ok: true, forgotten: true });
  assert.deepEqual(h.contextsDeleted, ['private-context-1']);
  assert.match(forgotten.headers['set-cookie'], /^__Host-tros-snap-device=; Path=\/; HttpOnly; SameSite=Strict; Max-Age=0; Secure$/);
  assert.equal([...h.store.keys()].some(key => key.startsWith('tros:snap:profile:v1:')), false);
  assert.equal([...h.store.keys()].some(key => key.endsWith(':lock')), false);
  assert.equal(forgotten.text.includes('private-context-1'), false);
  const missing = await forgetFrom(h.app()); assert.equal(missing.status, 400);
});

test('failed provider deletion retains the device mapping and cookie for a safe retry', async () => {
  const h = harness({ deleteContextUnavailable: true });
  const run = h.start(h.app(), '9'.repeat(64), { 'x-tros-snap-remember': '1' }); await run.ready;
  const cookie = run.res.headers['set-cookie'].split(';')[0];
  run.res.disconnect(); await run.done;
  const failed = await forgetFrom(h.app(), cookie);
  assert.equal(failed.status, 503);
  assert.equal(failed.headers['set-cookie'], undefined);
  assert.equal([...h.store.values()].includes('private-context-1'), true);
  assert.equal([...h.store.keys()].some(key => key.endsWith(':lock')), false);
  assert.equal(failed.text.includes(env.BROWSERBASE_API_KEY), false);
});

test('disconnect and deadline release the provider before terminating CDP so quota is not falsely locked', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const deadline of [false, true]) {
    const h = harness({ rejectReleaseAfterTerminate: true }), run = h.start(); await run.ready;
    if (deadline) t.mock.timers.tick(240000);
    else run.res.disconnect();
    await run.done;
    assert.equal(h.releases().length, 1);
    assert.equal(h.sockets[0].terminated, true);
    assert.equal([...h.store.keys()].some(key => key.endsWith(':lock')), false);
    assert.equal([...h.store.keys()].some(key => key.endsWith(':session')), false);
  }
});

test('a failed new profile mapping deletes only the empty profile created by that request before browser startup', async () => {
  const h = harness({ profileMapUnavailable: true });
  const run = h.start(h.app(), undefined, { 'x-tros-snap-remember': '1' }); await run.done;
  assert.equal(run.res.status, 503);
  assert.deepEqual(h.contextsCreated, ['private-context-1']);
  assert.deepEqual(h.contextsDeleted, ['private-context-1']);
  assert.equal(h.creates().length, 0);
  assert.equal(run.res.headers['set-cookie'], undefined);
  assert.equal([...h.store.keys()].some(key => key.endsWith(':lock')), false);
});
