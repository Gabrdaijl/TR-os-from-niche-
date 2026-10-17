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

test('reference proxy preset uses the same public endpoints and supports independent direct mode', () => {
 const { proxyEnvironment } = require('../server.cjs');
 const env = proxyEnvironment({});
 assert.equal(env.PROXY_WISP_URL, 'wss://t9os.space/wisp-vps/');
 assert.equal(env.VPN_WISP_URL, 'wss://t9os.space/wisp-mullvad/');
 assert.equal(env.VPN_API_URL, 'https://t9os.space');
 assert.equal(proxyEnvironment({ PROXY_PROVIDER: 'direct' }).VPN_API_URL, undefined);
 assert.equal(proxyEnvironment({ PROXY_PROVIDER: 'custom', VPN_API_URL: 'https://own.test' }).VPN_API_URL, 'https://own.test');
});

test('VPN API and both binary Wisp routes reach their configured upstream', async t => {
 const { WebSocketServer } = require('ws');
 const provider = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ relay: 'test-relay', path: req.url })); });
 const upstreamWs = new WebSocketServer({ server: provider });
 upstreamWs.on('connection', ws => { ws.send(Buffer.from([3,0,0,0,0,127,0,0,0])); ws.on('message', (data, binary) => ws.send(data, { binary })); });
 await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
 t.after(() => new Promise(resolve => { upstreamWs.close(); provider.close(resolve); }));
 const endpoint = '127.0.0.1:' + provider.address().port;
 const { base, request } = await fixture(t, { VPN_API_URL: 'http://' + endpoint, VPN_WISP_URL: 'ws://' + endpoint, PROXY_WISP_URL: 'ws://' + endpoint });
 assert.equal((await request('/api/mullvad/status')).data.relay, 'test-relay');
 for (const path of ['/wisp-vps/', '/wisp-mullvad/', '/wisp-mullvad-us/', '/wisp-mullvad-eu/', '/wisp-mullvad-se/']) {
  await new Promise((resolve, reject) => {
   const ws = new WebSocket(base.replace('http:', 'ws:') + path); let handshake = false;
   const timer = setTimeout(() => { ws.terminate(); reject(new Error('Wisp relay timed out')); }, 5000);
   ws.on('error', reject);
   ws.on('message', data => {
    if (!handshake) { assert.equal(data[0], 3); handshake = true; ws.send(Buffer.alloc(8192, 7)); }
    else { assert.equal(data.length, 8192); assert.equal(data[0], 7); clearTimeout(timer); ws.close(); resolve(); }
   });
  });
 }
});

test('cloud lifecycle forwards credentials, queue, player and quit to its provider', async t => {
 const calls = [];
 const provider = http.createServer(async (req, res) => {
  let body = ''; for await (const part of req) body += part;
  calls.push({ path: req.url, key: req.headers['x-api-key'], body });
  if (req.url.endsWith('/createSession')) { res.setHeader('content-type','application/x-ndjson'); return res.end(JSON.stringify({ status:'queue', uuid:'test-session', queue_pos:1 })); }
  if (req.url.startsWith('/cloud/v1/embed')) { res.setHeader('content-type','text/html'); return res.end('<title>Test provider</title>'); }
  res.setHeader('content-type','application/json');res.end(JSON.stringify({ ok:true, status:'finished_queue', uuid:'test-session' }));
 });
 await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
 t.after(() => new Promise(resolve => provider.close(resolve)));
 const { base, request } = await fixture(t, { CLOUD_API_URL:'http://127.0.0.1:'+provider.address().port, CLOUD_API_KEY:'test-cloud-key' });
 assert.equal((await request('/cloud/v1/createSession',{game_key:'test-game'})).data.uuid,'test-session');
 assert.equal((await request('/cloud/v1/getQueue?uuid=test-session')).data.status,'finished_queue');
 assert.equal((await request('/cloud/v1/startGame',{uuid:'test-session'})).status,200);
 assert.match(await (await fetch(base+'/cloud/v1/embed?id=test-session')).text(),/Test provider/);
 assert.equal((await request('/cloud/v1/quitSession',{uuid:'test-session'})).status,200);
 assert.ok(calls.every(call=>call.key==='test-cloud-key'));
 assert.ok(!(await (await fetch(base+'/tr-os.config.js')).text()).includes('test-cloud-key'));
});

test('cloud status distinguishes missing, reachable and offline providers without exposing credentials', async t => {
 const { request: missing } = await fixture(t, {});
 assert.deepEqual((await missing('/api/cloud/status')).data, { configured:false, available:false, keyRequired:false });
 const provider = http.createServer((req,res) => { res.writeHead(401); res.end(); });
 await new Promise(resolve => provider.listen(0,'127.0.0.1',resolve));
 const endpoint = 'http://127.0.0.1:' + provider.address().port;
 const { request } = await fixture(t, { CLOUD_API_URL:endpoint, CLOUD_API_KEY:'private-cloud-key' });
 assert.deepEqual((await request('/api/cloud/status')).data,{configured:true,available:true,keyRequired:false});
 await new Promise(resolve=>provider.close(resolve));
 assert.deepEqual((await request('/api/cloud/status')).data,{configured:true,available:false,keyRequired:false});
 const failed = await request('/cloud/v1/createSession',{game_key:'test'});
 assert.equal(failed.status,503);
 assert.match(failed.data.error,/could not be reached/);
 assert.ok(!JSON.stringify(failed.data).includes(endpoint));
});
