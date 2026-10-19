'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createModeration, hashDeviceId } = require('../moderation.cjs');
const { createApp } = require('../server.cjs');

function fakeRedis() {
  const records = new Map();
  const calls = [];
  const request = async (url, init) => {
    const parts = JSON.parse(init.body), [op, , id, value] = parts;
    calls.push(parts);
    let result = 'OK';
    if (op === 'HSET') { records.set(id, value); result = 1; }
    else if (op === 'HEXISTS') result = records.has(parts[2]) ? 1 : 0;
    else if (op === 'HGETALL') result = [...records].flatMap(entry => entry);
    else if (op === 'HDEL') result = records.delete(parts[2]) ? 1 : 0;
    return { ok: true, json: async () => ({ result }) };
  };
  return { records, calls, request };
}

test('moderation persists only a hashed browser ID and fixed reason, then supports unban', async () => {
  const device = crypto.randomBytes(32).toString('base64url');
  const redis = fakeRedis();
  const moderation = createModeration({ KV_REST_API_URL: 'https://redis.example', KV_REST_API_TOKEN: 'test-token' }, redis.request);
  const result = await moderation.ban(device);
  assert.equal(result.ok, true);
  assert.equal(result.source, 'redis');
  const id = hashDeviceId(device);
  assert.equal(result.id, id);
  assert.equal(await moderation.isBanned(device), true);
  const listing = await moderation.list();
  assert.equal(listing.source, 'redis');
  assert.equal(listing.bans.length, 1);
  assert.deepEqual(Object.keys(listing.bans[0]).sort(), ['createdAt', 'id', 'reason']);
  assert.equal(listing.bans[0].reason, 'adult-content-search');
  assert.ok(!JSON.stringify([...redis.records]).includes(device));
  assert.equal((await moderation.unban(id)).removed, true);
  assert.equal(await moderation.isBanned(device), false);
});

test('moderation support chat persists across server instances using only the hashed device ID', async () => {
  const hashes = new Map(), sorted = new Map();
  const request = async (_url, init) => {
    const parts = JSON.parse(init.body), [op, key, field, value] = parts;
    let result = 'OK';
    if (op === 'HSET') { const hash=hashes.get(key)||new Map();hash.set(field,value);hashes.set(key,hash);result=1; }
    else if (op === 'HGET') result = hashes.get(key)?.get(field) || null;
    else if (op === 'ZADD') { const set=sorted.get(key)||new Map();set.set(parts[3],Number(parts[2]));sorted.set(key,set);result=1; }
    else if (op === 'ZREVRANGE') result = [...(sorted.get(key)||new Map())].sort((a,b)=>b[1]-a[1]).slice(Number(parts[2]),Number(parts[3])+1).map(([member])=>member);
    else if (op === 'HGETALL') result = [...(hashes.get(key)||new Map())].flatMap(entry=>entry);
    else if (op === 'HEXISTS') result = hashes.get(key)?.has(parts[2]) ? 1 : 0;
    else if (op === 'HDEL') result = hashes.get(key)?.delete(parts[2]) ? 1 : 0;
    return { ok: true, json: async () => ({ result }) };
  };
  const env={KV_REST_API_URL:'https://redis.example',KV_REST_API_TOKEN:'test-token'};
  const browserService=createModeration(env,request), adminService=createModeration(env,request);
  const device=crypto.randomBytes(32).toString('base64url');
  const ban=await browserService.ban(device);
  assert.equal((await browserService.sendBrowserMessage(device,'Jag blev blockerad av misstag.')).ok,true);
  const conversationList=await adminService.listConversations();
  assert.equal(conversationList.source,'redis');
  assert.equal(conversationList.conversations[0].id,hashDeviceId(device));
  assert.equal(conversationList.conversations[0].messages[0].role,'browser');
  assert.equal((await adminService.sendAdminMessage(ban.id,'Jag kontrollerar spärren.')).ok,true);
  const inbox=await browserService.messagesForDevice(device);
  assert.deepEqual(inbox.messages.map(message=>message.role),['browser','admin']);
});

test('detected adult searches are stopped before external autocomplete and can be unbanned by admin', async t => {
  const originalFetch = global.fetch;
  const externalCalls = [];
  const pushEvents = [];
  const push = {
    notifyAdmins: (...args) => { pushEvents.push(['admin', ...args]); return Promise.resolve({ ok: true, sent: 1 }); },
    notifyBrowser: (...args) => { pushEvents.push(['browser', ...args]); return Promise.resolve({ ok: true, sent: 1 }); },
    publicKey: async () => 'public-key', registerAdmin: async () => ({ ok: true }), removeAdmin: async () => ({ ok: true }),
    registerBrowser: async () => ({ ok: true }), removeBrowser: async () => ({ ok: true })
  };
  global.fetch = async (...args) => { externalCalls.push(args); throw new Error('Unexpected external request'); };
  const password = 'moderation-test-password';
  const app = createApp({ env: { ADMIN_PASSWORD: password }, push });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { global.fetch = originalFetch; await app.close(); });
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const localFetch = (...args) => originalFetch(...args);
  const home = await localFetch(base + '/');
  const cookie = home.headers.get('set-cookie').split(';', 1)[0];
  assert.match(cookie, /^tros-device=[A-Za-z0-9_-]{32,64}$/);

  const suggestion = await localFetch(base + '/suggest?q=porn', { headers: { cookie } });
  assert.equal(suggestion.status, 403);
  assert.equal((await suggestion.json()).banned, true);
  assert.equal(externalCalls.length, 0, 'The adult search must not be forwarded to autocomplete');
  assert.equal(pushEvents.some(event => event[0] === 'admin' && event[1] === 'Ny spärr'), true);
  const blockedHome = await localFetch(base + '/', { headers: { cookie } });
  const blockedText = await blockedHome.text();
  assert.equal(blockedHome.status, 403, blockedText);
  assert.match(blockedText, /Webbläsaren är blockerad/);
  assert.match(blockedText, /Anledning:<\/strong> Systemet har upptäckt sökningar efter pornografiskt eller annat sexuellt innehåll och blockerat webbläsaren automatiskt\./);
  assert.match(blockedText, /Kontakta administratören så hjälper han dig med problemet\./);
  assert.equal((await localFetch(base + '/api/health', { headers: { cookie } })).status, 403);
  assert.equal((await localFetch(base + '/admin.html', { headers: { cookie } })).status, 200);

  const authorization = 'Basic ' + Buffer.from('admin:' + password).toString('base64');
  const listedResponse = await localFetch(base + '/api/admin/moderation/bans', { headers: { authorization } });
  assert.equal(listedResponse.status, 200);
  const listedText = await listedResponse.text();
  assert.ok(!listedText.includes('porn'));
  const listed = JSON.parse(listedText);
  assert.equal(listed.bans.length, 1);
  assert.equal(listed.bans[0].id, hashDeviceId(cookie.slice('tros-device='.length)));

  const supportMessage = await localFetch(base + '/api/moderation/messages', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Hej, jag tror att detta blev fel.' }) });
  assert.equal(supportMessage.status, 201);
  assert.equal(pushEvents.some(event => event[0] === 'admin' && event[1] === 'Nytt supportmeddelande'), true);
  const conversations = await localFetch(base + '/api/admin/moderation/conversations', { headers: { authorization } });
  assert.equal(conversations.status, 200);
  const chat = await conversations.json();
  assert.equal(chat.conversations.length, 1);
  assert.equal(chat.conversations[0].messages[0].role, 'browser');
  const reply = await localFetch(base + '/api/admin/moderation/conversations/' + listed.bans[0].id + '/messages', { method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Jag hjälper dig.' }) });
  assert.equal(reply.status, 201);
  assert.equal(pushEvents.some(event => event[0] === 'browser' && event[1] === listed.bans[0].id && event[2] === 'Svar från TR-os admin'), true);
  const inbox = await (await localFetch(base + '/api/moderation/messages', { headers: { cookie } })).json();
  assert.deepEqual(inbox.messages.map(message => message.role), ['browser', 'admin']);
  assert.equal((await localFetch(base + '/api/moderation/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Ingen spärr' }) })).status, 403);

  const remove = await localFetch(base + '/api/admin/moderation/bans/' + listed.bans[0].id, { method: 'DELETE', headers: { authorization } });
  assert.equal(remove.status, 200);
  assert.equal(pushEvents.some(event => event[0] === 'browser' && event[1] === listed.bans[0].id && event[2] === 'Spärren är hävd'), true);
  assert.equal((await localFetch(base + '/', { headers: { cookie } })).status, 200);
  assert.equal((await (await localFetch(base + '/api/admin/moderation/bans', { headers: { authorization } })).json()).bans.length, 0);
  const supportPage = await localFetch(base + '/support.html', { headers: { cookie } });
  assert.equal(supportPage.status, 200);
  assert.match(await supportPage.text(), /Supportchat/);
  const afterUnban = await localFetch(base + '/api/moderation/messages', { headers: { cookie } });
  assert.equal(afterUnban.status, 200, 'The browser can keep using its existing conversation after unban');
  const followUp = await localFetch(base + '/api/moderation/messages', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Tack för hjälpen.' }) });
  assert.equal(followUp.status, 201);
});
