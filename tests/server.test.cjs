'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { WebSocket } = require('ws');
const { createApp } = require('../server.cjs');

async function fixture(t, env = {}) {
  const app = createApp({ env });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const request = async (route, data) => {
    const response = await fetch(base + route, data === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    return { status: response.status, data: await response.json() };
  };
  return { app, base, request };
}
test('serves the app and prevents access to server files and secrets', async t => {
  const { base, request } = await fixture(t);
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/scram/scramjet.wasm.wasm')).headers.get('content-type'), 'application/wasm');
  for (const route of ['/.env', '/server.cjs', '/package-lock.json', '/node_modules/ws/index.js', '/tests/server.test.cjs']) assert.equal((await fetch(base + route)).status, 404, route);
  const health = await request('/api/health');
  assert.equal(health.data.services.chat, true);
  assert.equal(health.data.services.vpn, false);
});
test('session secrets protect identity and direct messages', async t => {
  const { request } = await fixture(t);
  const a = (await request('/online', {})).data;
  const b = (await request('/online', {})).data;
  assert.equal((await request('/online', { token: a.token, secret: a.secret })).data.token, a.token);
  assert.equal((await request('/online')).data.online, 2);
  assert.equal((await request('/chat/send', { from: a.token, secret: 'bad', to: b.token, text: 'forged' })).status, 401);
  assert.equal((await request('/chat/send', { from: a.token, secret: a.secret, to: b.token, text: '<b>hello</b>' })).status, 200);
  assert.equal((await request('/chat/inbox?token=' + b.token + '&secret=bad')).status, 401);
  const inbox = (await request('/chat/inbox?token=' + b.token + '&secret=' + b.secret)).data;
  assert.equal(inbox.messages.length, 1);
  assert.equal(inbox.messages[0].text, '<b>hello</b>');
  assert.equal(inbox.messages[0].from, a.token);
  assert.equal((await request('/chat/inbox?token=' + a.token + '&secret=' + a.secret)).data.messages.length, 0);
});
test('room messages use increasing cursors and validate input', async t => {
  const { base, request } = await fixture(t);
  const user = (await request('/online', {})).data;
  const send = text => request('/chat/send', { from: user.token, secret: user.secret, to: 'all', text });
  await send('first'); await send('second');
  const room = (await request('/chat/room?since=0')).data.messages;
  assert.equal(room.length, 2);
  assert.ok(room[1].ts > room[0].ts);
  assert.equal((await request('/chat/room?since=' + room[0].ts)).data.messages[0].text, 'second');
  assert.equal((await send('')).status, 400);
  assert.equal((await send('x'.repeat(4001))).status, 400);
  assert.equal((await fetch(base + '/online', { method: 'POST', body: '{' })).status, 400);
  assert.equal((await fetch(base + '/online', { method: 'POST', headers: { origin: 'https://other.example' }, body: '{}' })).status, 403);
});
test('presence WebSocket and Wisp handshake are available', async t => {
  const { base } = await fixture(t);
  for (const route of ['/tros-ws', '/wisp-vps/']) {
    const socket = new WebSocket(base.replace('http:', 'ws:') + route);
    t.after(() => socket.terminate());
    const message = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No handshake: ' + route)), 2000);
      socket.on('message', data => { clearTimeout(timer); resolve(data); });
      socket.on('error', error => { clearTimeout(timer); reject(error); });
    });
    if (route === '/tros-ws') assert.equal(typeof JSON.parse(message).online, 'number');
    else assert.ok(message.length >= 5);
    socket.close();
  }
});
test('unconnected paid services return explicit errors and no false VPN state', async t => {
  const { request } = await fixture(t);
  assert.equal((await request('/cloud/v1/createSession', {})).status, 503);
  assert.equal((await request('/api/mullvad/status')).data.vpn, false);
  assert.equal((await request('/api/mullvad/switch', { id: 'unknown' })).status, 503);
});
test('AI relays stream responses and keep provider credentials on the server', async t => {
  let received;
  const provider = http.createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    received = { authorization: req.headers.authorization, data: JSON.parse(text) };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: {"choices":[{"delta":{"content":"test"}}]}\n\ndata: [DONE]\n\n');
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => provider.close(resolve)));
  const { base } = await fixture(t, { AI_URL: 'http://127.0.0.1:' + provider.address().port, AI_KEY: 'test-secret', AI_MODEL: 'configured-model' });
  const response = await fetch(base + '/api/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'client-model', messages: [{ role: 'user', content: 'hello' }], stream: true }) });
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.ok(text.includes('data: [DONE]'));
  assert.equal(received.authorization, 'Bearer test-secret');
  assert.equal(received.data.model, 'configured-model');
  assert.ok(!(await (await fetch(base + '/tr-os.config.js')).text()).includes('test-secret'));
});
