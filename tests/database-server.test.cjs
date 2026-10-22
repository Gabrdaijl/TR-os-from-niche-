'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { WebSocket } = require('ws');
const { createApp } = require('../server.cjs');

async function fixture(t, status = 'ready') {
  let authentications = 0;
  const app = createApp({ env: { ADMIN_PASSWORD: 'test-only-password' }, memberships: {
    authenticate: async () => { authentications++; return { user: { firstName: 'Test', lastName: 'Member' } }; },
    hasAccess: () => true,
    healthDetails: async () => ({ status, reason: status === 'ready' ? 'ok' : 'monthly_request_limit_http_400' })
  } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const request = async (route, data) => {
    const response = await fetch(base + route, data === undefined ? {} : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data)
    });
    return { status: response.status, data: await response.json() };
  };
  return { base, request, count: () => authentications };
}

test('one heartbeat authenticates once and preserves its existing online identity', async t => {
  const { request, count } = await fixture(t);
  const first = await request('/online', {});
  assert.equal(first.status, 200);
  assert.equal(count(), 1);
  const second = await request('/online', first.data);
  assert.equal(second.data.token, first.data.token);
  assert.equal(second.data.secret, first.data.secret);
  assert.equal(count(), 2);
});

test('combined chat updates retain room cursors and isolate private inboxes', async t => {
  const { request } = await fixture(t);
  const a = (await request('/online', {})).data;
  const b = (await request('/online', {})).data;
  const send = async (to, text) => {
    const result = await request('/chat/send', { from: a.token, secret: a.secret, to, text });
    assert.equal(result.status, 200);
  };
  await send('all', 'Test room message');
  await send(b.token, 'Test private message');
  const updates = user => '/chat/updates?' + new URLSearchParams({ token: user.token, secret: user.secret });
  const first = await request(updates(b));
  assert.deepEqual(first.data.room.map(message => message.text), ['Test room message']);
  assert.deepEqual(first.data.inbox.map(message => message.text), ['Test private message']);
  const cursor = await request(updates(b) + '&roomSince=' + first.data.room[0].ts + '&inboxSince=' + first.data.inbox[0].ts);
  assert.deepEqual(cursor.data, { room: [], inbox: [] });
  assert.deepEqual((await request(updates(a))).data.inbox, []);
  assert.equal((await request(updates({ ...b, secret: a.secret }))).status, 401);
});

async function subscribed(t, base, user) {
  const socket = new WebSocket(base.replace('http:', 'ws:') + '/tros-ws');
  const notifications = [];
  socket.on('message', raw => notifications.push(JSON.parse(raw)));
  t.after(() => socket.terminate());
  await once(socket, 'open');
  const ready = new Promise(resolve => socket.on('message', raw => {
    if (JSON.parse(raw).type === 'chat-ready') resolve();
  }));
  socket.send(JSON.stringify({ type: 'subscribe-chat', token: user.token, secret: user.secret }));
  await ready;
  return { socket, notifications };
}

test('chat socket sends generic notifications only to the relevant authenticated subscribers', { timeout: 5000 }, async t => {
  const { base, request } = await fixture(t);
  const users = [];
  for (let i = 0; i < 3; i++) users.push((await request('/online', {})).data);
  const subscribers = await Promise.all(users.map(user => subscribed(t, base, user)));
  const recipientUpdate = once(subscribers[1].socket, 'message');
  assert.equal((await request('/chat/send', {
    from: users[0].token, secret: users[0].secret, to: users[1].token, text: 'Private test content'
  })).status, 200);
  assert.deepEqual(JSON.parse((await recipientUpdate)[0]), { type: 'chat-update' });
  // Each ordered socket receives the room notification after any private notification.
  const roomUpdates = subscribers.map(subscriber => once(subscriber.socket, 'message'));
  await request('/chat/send', { from: users[0].token, secret: users[0].secret, to: 'all', text: 'Room test content' });
  await Promise.all(roomUpdates);
  assert.equal(subscribers[2].notifications.filter(message => message.type === 'chat-update').length, 1);
  assert.equal(subscribers[1].notifications.filter(message => message.type === 'chat-update').length, 2);
  assert.ok(subscribers.every(subscriber => !JSON.stringify(subscriber.notifications).includes('test content')));
});

test('socket subscription rejects a forged session secret', { timeout: 5000 }, async t => {
  const { base, request } = await fixture(t);
  const user = (await request('/online', {})).data;
  const socket = new WebSocket(base.replace('http:', 'ws:') + '/tros-ws');
  t.after(() => socket.terminate());
  await once(socket, 'open');
  const closed = once(socket, 'close');
  socket.send(JSON.stringify({ type: 'subscribe-chat', token: user.token, secret: '0'.repeat(64) }));
  assert.equal((await closed)[0], 1008);
});

test('admin reports membership database health independently of presence configuration', async t => {
  for (const state of ['ready', 'unavailable']) {
    const { base } = await fixture(t, state);
    const response = await fetch(base + '/api/admin/status', { headers: {
      authorization: 'Basic ' + Buffer.from('admin:test-only-password').toString('base64')
    } });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.database.status, state);
    assert.notEqual(data.presence.source, 'redis');
    assert.equal(data.databaseDiagnostic.lastFailure, state === 'ready' ? null : 'monthly_request_limit_http_400');
    assert.ok(!JSON.stringify(data).includes('test-only-password'));
  }
});

test('combined updates keep membership storage failures enforced', async t => {
  const app = createApp({ env: {}, memberships: {
    authenticate: async () => { throw Object.assign(new Error('Storage unavailable'), { status: 503 }); }
  } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const response = await fetch('http://127.0.0.1:' + app.server.address().port + '/chat/updates?token=forged&secret=forged');
  assert.equal(response.status, 503);
});
