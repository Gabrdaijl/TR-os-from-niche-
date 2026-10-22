'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'lapisae52.js'), 'utf8');
const start = source.indexOf('/* TR-os chat synchronization start */');
const end = source.indexOf('/* TR-os chat synchronization end */', start);
assert.ok(start >= 0 && end > start, 'chat synchronization section exists');
const chatSource = source.slice(start, end);
const reply = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
const flush = async () => { for (let index = 0; index < 15; index++) await Promise.resolve(); };

class Element {
  constructor(id = '') {
    this.id = id;
    this.hidden = id === 'chat-pop';
    this.value = '';
    this.children = [];
    this.style = {};
    this.events = new Map();
    this.scrollTop = 0;
    this.textContent = '';
  }
  set innerHTML(value) { this.children = []; this._html = value; }
  get innerHTML() { return this._html || ''; }
  get scrollHeight() { return this.children.length; }
  appendChild(element) { this.children.push(element); return element; }
  addEventListener(type, listener) {
    if (!this.events.has(type)) this.events.set(type, []);
    this.events.get(type).push(listener);
  }
}

async function browser(options = {}) {
  let now = 1800000000000, timerId = 0;
  const timers = new Map(), elements = new Map(), documentEvents = new Map(), windowEvents = new Map();
  const calls = [], sockets = [], storage = new Map([
    ['tros-online-id', 'self-token'], ['tros-online-secret', 'private-chat-secret']
  ]);
  let handler = options.handler;
  const get = id => {
    if (!elements.has(id)) elements.set(id, new Element(id));
    return elements.get(id);
  };
  const add = (events, type, listener) => {
    if (!events.has(type)) events.set(type, []);
    events.get(type).push(listener);
  };
  const document = {
    visibilityState: options.hidden ? 'hidden' : 'visible',
    getElementById: get,
    createElement: () => new Element(),
    addEventListener: (type, listener) => add(documentEvents, type, listener)
  };
  class FakeWebSocket {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
    open() { this.readyState = 1; this.onopen?.(); }
    receive(data) { this.onmessage?.({ data: JSON.stringify(data) }); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close(code = 1000) { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.({ code }); }
  }
  const runtime = {
    apiBase: 'https://api.tr-os.test',
    identity: async () => ({ token: storage.get('tros-online-id'), secret: storage.get('tros-online-secret') }),
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (handler) return handler(url, init, calls.length);
      if (url.startsWith('/chat/updates')) return reply(200, { room: [], inbox: [] });
      if (url.startsWith('/chat/room')) return reply(200, { messages: [] });
      if (url === '/online') return reply(200, { token: 'renewed-token', secret: 'renewed-secret' });
      return reply(200, { ok: true });
    }
  };
  const window = { TR_OS: runtime, addEventListener: (type, listener) => add(windowEvents, type, listener) };
  const context = {
    window, document, URL, Date: { now: () => now },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    AbortSignal: { timeout: () => ({}) },
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id)
  };
  if (options.websocket !== false) context.WebSocket = FakeWebSocket;
  await vm.runInNewContext(chatSource, context);
  await flush();
  async function event(events, type, data = {}) {
    for (const listener of events.get(type) || []) await listener(data);
    await flush();
  }
  async function advance(milliseconds) {
    const target = now + milliseconds;
    let loops = 0;
    while (true) {
      const due = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      assert.ok(++loops < 1000, 'timers do not busy loop');
      now = due[1].at;
      timers.delete(due[0]);
      due[1].callback();
      await flush();
    }
    now = target;
    await flush();
  }
  return {
    calls, sockets, storage, document, timers, get, advance, now: () => now,
    setHandler: value => { handler = value; },
    visibility: async hidden => { document.visibilityState = hidden ? 'hidden' : 'visible'; await event(documentEvents, 'visibilitychange'); },
    pagehide: () => event(windowEvents, 'pagehide'),
    pageshow: persisted => event(windowEvents, 'pageshow', { persisted }),
    click: id => event(get(id).events, 'click')
  };
}

test('chat uses one combined catch-up and a WebSocket subscription without credentials in its URL', async () => {
  const app = await browser();
  assert.equal(app.calls.length, 1);
  const url = new URL(app.calls[0].url, 'https://api.tr-os.test');
  assert.equal(url.pathname, '/chat/updates');
  assert.equal(url.searchParams.get('token'), 'self-token');
  assert.equal(url.searchParams.get('secret'), 'private-chat-secret');
  assert.equal(app.sockets[0].url, 'wss://api.tr-os.test/tros-ws');
  app.sockets[0].open();
  assert.deepEqual(app.sockets[0].sent[0], { type: 'subscribe-chat', token: 'self-token', secret: 'private-chat-secret' });
  app.sockets[0].receive({ type: 'chat-ready' });
  await flush();
  const afterReady = app.calls.length;
  await app.advance(180000);
  assert.equal(app.calls.length, afterReady, 'ready WebSocket eliminates idle HTTP polling');
  assert.equal(app.calls.filter(call => call.url === '/online').length, 0, 'identity is not registered twice');
  await app.pagehide();
});

test('incoming events preserve popup notifications, cursors, room deduplication and reply destinations', async () => {
  const app = await browser();
  const socket = app.sockets[0];
  socket.open();
  socket.receive({ type: 'chat-ready' });
  await flush();
  const roomTime = app.now() + 1, inboxTime = app.now() + 2;
  app.setHandler(url => {
    if (url.startsWith('/chat/updates')) return reply(200, {
      room: [{ id: 'room-1', from: 'other', fromName: 'Room friend', text: 'Group message', ts: roomTime }],
      inbox: [{ id: 'dm-1', from: 'peer-token', fromName: 'Promax', text: 'Private message', ts: inboxTime }]
    });
    if (url.startsWith('/chat/room')) return reply(200, { messages: [] });
    return reply(200, { ok: true });
  });
  await app.visibility(true);
  socket.receive({ type: 'chat-update' });
  await flush();
  assert.equal(app.get('chat-pop').hidden, false, 'event-driven incoming notifications continue in background');
  assert.equal(app.get('chat-pop-from').textContent, 'Promax');
  assert.equal(app.get('chat-pop-msgs').children[0].textContent, 'Promax: Private message');
  assert.equal(app.get('pop-gc-msgs').children.length, 1);
  app.setHandler(url => url.startsWith('/chat/updates')
    ? reply(200, { room: [{ id: 'room-1', from: 'other', text: 'Group message', ts: roomTime }], inbox: [] })
    : url.startsWith('/chat/room') ? reply(200, { messages: [] }) : reply(200, { ok: true }));
  socket.receive({ type: 'chat-update' });
  await flush();
  const latest = new URL(app.calls.filter(call => call.url.startsWith('/chat/updates')).at(-1).url, 'https://api.tr-os.test');
  assert.equal(latest.searchParams.get('roomSince'), String(roomTime));
  assert.equal(latest.searchParams.get('inboxSince'), String(inboxTime));
  assert.equal(app.get('pop-gc-msgs').children.length, 1, 'repeated room IDs are not rendered twice');
  app.get('chat-pop-input').value = 'Reply';
  await app.click('chat-pop-send');
  assert.deepEqual(JSON.parse(app.calls.findLast(call => call.url === '/chat/send').init.body), {
    from: 'self-token', secret: 'private-chat-secret', to: 'peer-token', text: 'Reply'
  });
  app.get('pop-gc-input').value = 'Group reply';
  await app.click('pop-gc-send');
  assert.equal(JSON.parse(app.calls.findLast(call => call.url === '/chat/send').init.body).to, 'all');
  await app.pagehide();
});

test('bursts coalesce into one follow-up while fallback skips hidden pages and cleans up on pagehide', async () => {
  const app = await browser();
  const socket = app.sockets[0];
  socket.open();
  socket.receive({ type: 'chat-ready' });
  await flush();
  let resolve;
  let first = true;
  app.setHandler(() => {
    if (first) { first = false; return new Promise(done => { resolve = done; }); }
    return reply(200, { room: [], inbox: [] });
  });
  const before = app.calls.length;
  socket.receive({ type: 'chat-update' });
  socket.receive({ type: 'chat-update' });
  socket.receive({ type: 'chat-update' });
  assert.equal(app.calls.length, before + 1);
  resolve(reply(200, { room: [], inbox: [] }));
  await flush();
  assert.equal(app.calls.length, before + 2, 'one catch-up fetch covers all events received during the pending request');
  socket.close();
  await app.visibility(true);
  const hiddenCount = app.calls.length;
  await app.advance(180000);
  assert.equal(app.calls.length, hiddenCount);
  await app.visibility(false);
  assert.equal(app.calls.length, hiddenCount + 1, 'visible pages catch up immediately');
  await app.pagehide();
  const closedCount = app.calls.length, socketCount = app.sockets.length;
  await app.advance(600000);
  await app.visibility(false);
  assert.equal(app.calls.length, closedCount);
  assert.equal(app.sockets.length, socketCount);
  assert.equal(app.timers.size, 0);
});

test('fallback starts at one minute and backs off failed database requests to five minutes', async () => {
  const app = await browser({ websocket: false, handler: () => reply(503, { error: 'storage unavailable' }) });
  assert.equal(app.calls.length, 1);
  await app.advance(60000);
  assert.equal(app.calls.length, 2);
  await app.advance(60000);
  assert.equal(app.calls.length, 2);
  await app.advance(60000);
  assert.equal(app.calls.length, 3);
  await app.advance(240000);
  assert.equal(app.calls.length, 4);
  await app.advance(300000);
  assert.equal(app.calls.length, 5);
  assert.ok([...app.timers.values()].every(timer => timer.delay <= 300000));
  await app.pagehide();
});

test('WebSocket reconnect attempts have bounded backoff and stop when the page closes', async () => {
  const app = await browser();
  const delays = [];
  for (let index = 0; index < 9; index++) {
    app.sockets.at(-1).close();
    const reconnect = [...app.timers.values()].filter(timer => timer.delay < 60000).sort((a, b) => a.delay - b.delay)[0];
    const delay = reconnect?.delay || 60000;
    delays.push(delay);
    await app.advance(delay);
  }
  assert.deepEqual(delays.slice(0, 5), [1000, 2000, 4000, 8000, 16000]);
  assert.equal(Math.max(...delays), 60000);
  await app.pagehide();
  const count = app.sockets.length;
  await app.advance(600000);
  assert.equal(app.sockets.length, count);
});

test('expired chat identities renew once and resubscribe without putting credentials in the WebSocket URL', async () => {
  const app = await browser();
  app.sockets[0].open();
  app.sockets[0].close(1008);
  await flush();
  const renewals = app.calls.filter(call => call.url === '/online');
  assert.equal(renewals.length, 1);
  assert.deepEqual(JSON.parse(renewals[0].init.body), { token: 'self-token', secret: 'private-chat-secret' });
  assert.equal(app.sockets.length, 2, 'successful renewal reconnects immediately');
  assert.equal(app.sockets[1].url, 'wss://api.tr-os.test/tros-ws');
  app.sockets[1].open();
  assert.deepEqual(app.sockets[1].sent[0], { type: 'subscribe-chat', token: 'renewed-token', secret: 'renewed-secret' });
  app.sockets[1].receive({ type: 'chat-error' });
  await flush();
  assert.equal(app.calls.filter(call => call.url === '/online').length, 1, 'repeated rejection cannot create an identity retry loop');
  await app.advance(1000);
  assert.equal(app.sockets.length, 3);
  app.sockets[2].open();
  app.sockets[2].receive({ type: 'chat-error' });
  await flush();
  assert.equal(app.calls.filter(call => call.url === '/online').length, 1);
  await app.pagehide();
});

test('HTTP identity renewal retries once and a restored cached page resumes catch-up', async () => {
  const app = await browser({ websocket: false, handler: url => {
    if (url === '/online') return reply(200, { token: 'renewed-token', secret: 'renewed-secret' });
    const token = new URL(url, 'https://api.tr-os.test').searchParams.get('token');
    return token === 'renewed-token' ? reply(200, { room: [], inbox: [] }) : reply(401, { error: 'expired' });
  } });
  assert.equal(app.calls.length, 3);
  assert.equal(app.storage.get('tros-online-secret'), 'renewed-secret');
  await app.pagehide();
  const before = app.calls.length;
  await app.pageshow(false);
  assert.equal(app.calls.length, before);
  await app.pageshow(true);
  assert.equal(app.calls.length, before + 1);
  await app.advance(60000);
  assert.equal(app.calls.length, before + 2, 'restored pages resume visible fallback polling');
  await app.pagehide();
});

