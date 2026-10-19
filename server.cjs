'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isIP } = require('node:net');
const { Readable } = require('node:stream');
const { WebSocketServer, WebSocket } = require('ws');
const { server: wisp } = require('@mercuryworkshop/wisp-js/server');
const { createPresence } = require('./presence.cjs');
const { createTraffic } = require('./traffic.cjs');
const { createReports } = require('./reports.cjs');
const { COOKIE: MODERATION_COOKIE, cookieDeviceId, createModeration } = require('./moderation.cjs');
const { createPushNotifications } = require('./push.cjs');
const { createMemberships } = require('./memberships.cjs');
const { detects: detectsAdultSearch } = require('./adult-search.js');

const BLOCKED_HTML = '<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0b111a"><title>Webbläsaren är blockerad · TR-os</title><link rel="stylesheet" href="/support.css?v=20261020.1"></head><body><main class="support-shell blocked-shell"><a class="support-brand" href="/" aria-label="TR-os"><span class="brand-mark">T</span><span>TR-os<small>Hjälpcenter</small></span></a><section class="block-card"><div class="block-icon" aria-hidden="true">!</div><p class="support-eyebrow">ÅTKOMST SPÄRRAD</p><h1>Webbläsaren är blockerad</h1><p class="block-reason"><strong>Anledning:</strong> Systemet har upptäckt sökningar efter pornografiskt eller annat sexuellt innehåll och blockerat webbläsaren automatiskt.</p><p class="block-help">Kontakta administratören så hjälper han dig med problemet.</p><section class="support-chat-card" aria-labelledby="moderation-chat-title"><div class="chat-heading"><div><p class="support-eyebrow">SUPPORT</p><h2 id="moderation-chat-title">Skriv till admin</h2></div><span class="chat-status"><i></i> Privat ärende</span></div><p class="chat-intro">Beskriv vad som hänt. Du kan fortsätta chatten även efter att spärren hävts.</p><div id="moderation-chat-messages" class="support-messages" role="log" aria-live="polite"></div><form id="moderation-chat-form" class="support-form"><label class="sr-only" for="moderation-chat-input">Ditt meddelande</label><textarea id="moderation-chat-input" maxlength="2000" required rows="3" placeholder="Skriv ditt meddelande…"></textarea><div class="support-form-bottom"><span id="moderation-chat-state" role="status" aria-live="polite"></span><button type="submit"><span>Skicka</span><span aria-hidden="true">↗</span></button></div></form><button id="moderation-push" class="push-opt-in" type="button">Få en notis när admin svarar</button><span id="moderation-push-state" class="push-state" role="status" aria-live="polite"></span><a class="support-link" href="/support.html">Öppna supportchatten senare <span aria-hidden="true">→</span></a></section></section><footer class="support-footer">TR-os · Hjälpcenter</footer></main><script src="/moderation-client.js?v=20261020.1" defer></script></body></html>';

function deviceCookie(req, res, env) {
  const existing = cookieDeviceId(req.headers.cookie);
  if (existing) return existing;
  const id = crypto.randomBytes(32).toString('base64url');
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const secure = forwarded === 'https' || env.VERCEL === '1' || env.RENDER === 'true' || env.NODE_ENV === 'production';
  const cookie = MODERATION_COOKIE + '=' + id + '; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax' + (secure ? '; Secure' : '');
  const previous = res.getHeader('set-cookie');
  res.setHeader('set-cookie', previous ? [...(Array.isArray(previous) ? previous : [previous]), cookie] : cookie);
  return id;
}

function proxyEnvironment(source) {
  const env = { ...source };
  env.PROXY_PROVIDER ||= 'direct';
  if (env.PROXY_PROVIDER === 'reference') {
    env.PROXY_PROVIDER = 'reference';
    env.PROXY_WISP_URL ||= 'wss://t9os.space/wisp-vps/';
    env.VPN_WISP_URL ||= 'wss://t9os.space/wisp-mullvad/';
    env.VPN_API_URL ||= 'https://t9os.space';
    env.CLOUD_API_URL ||= 'https://t9os.space';
  }
  return env;
}

function createApp(options = {}) {
  const root = options.root || __dirname;
  const env = options.env || process.env;
  const sessions = new Map(), messages = [], limits = new Map();
  const sockets = new Set();
  let lastStamp = Date.now();
  const startedAt = Date.now();
  let requestCount = 0, serverErrors = 0;
  const nowStamp = () => lastStamp = Math.max(Date.now(), lastStamp + 1);
  const activeCount = () => [...sessions.values()].filter(s => Date.now() - s.seen < 45000).length;
  const presence = createPresence(env, activeCount);
  const traffic = createTraffic(env);
  const moderation = createModeration(env);
  const memberships = options.memberships || createMemberships(env);
  const reports = createReports(env);
  const push = options.push || createPushNotifications(env);
  function notify(promise) { Promise.resolve(promise).catch(error => console.warn('Push delivery failed:', error.message)); }
  const json = (res, status, data) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  function appendCookie(res, cookie) {
    const current = res.getHeader('set-cookie');
    const cookies = current ? Array.isArray(current) ? current : [current] : [];
    res.setHeader('set-cookie', [...cookies, cookie]);
  }
  function authenticated(token, secret) {
    const user = sessions.get(token);
    if (!user || typeof secret !== 'string' || !/^[a-f0-9]{64}$/.test(secret)) return null;
    return crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(user.secret)) ? user : null;
  }
  async function body(req, maxBytes = 1024 * 1024) {
    let length = 0, chunks = [];
    for await (const chunk of req) {
      length += chunk.length;
      if (length > maxBytes) throw Object.assign(new Error('Request is too large'), { status: 413 });
      chunks.push(chunk);
    }
    try {
      const value = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Object required');
      return value;
    }
    catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
  }
  function allowed(req, bucket = 'general', maximum = 300) {
    // Render's public ingress overwrites CF-Connecting-IP. X-Forwarded-For
    // can contain caller-supplied entries, so never use it for rate limits.
    const forwarded = req.headers['cf-connecting-ip'];
    const clientIp = env.RENDER === 'true' && typeof forwarded === 'string' && isIP(forwarded)
      ? forwarded : req.socket.remoteAddress;
    const key = bucket + ':' + clientIp;
    let limit = limits.get(key);
    if (!limit || limit.until < Date.now()) limits.set(key, limit = { n: 0, until: Date.now() + 60000 });
    return ++limit.n <= maximum;
  }
  function broadcast() {
    const message = JSON.stringify({ online: activeCount() });
    for (const socket of sockets) if (socket.readyState === WebSocket.OPEN) socket.send(message);
  }
  async function relay(res, url, init = {}) {
    const upstream = await fetch(url, { ...init, signal: AbortSignal.timeout(90000), redirect: 'error' });
    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    if (!upstream.body) return res.end();
    const stream = Readable.fromWeb(upstream.body);
    res.on('close', () => stream.destroy());
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }
  function configuredUrl(base, suffix) {
    const url = new URL(base.replace(/\/$/, '') + suffix);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported service URL');
    return url;
  }
  function adminAuthorized(req, res) {
    if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 8) {
      json(res, 503, { error: 'Admin är låst. Sätt ADMIN_PASSWORD (minst 8 tecken) som Sensitive i Vercel och publicera igen.' });
      return false;
    }
    const expected = 'Basic ' + Buffer.from('admin:' + env.ADMIN_PASSWORD).toString('base64');
    const digest = value => crypto.createHash('sha256').update(value).digest();
    if (crypto.timingSafeEqual(digest(req.headers.authorization || ''), digest(expected))) return true;
    if (!allowed(req, 'admin-login', 5)) json(res, 429, { error: 'För många försök. Vänta en minut.' });
    else json(res, 401, { error: 'Fel lösenord eller utloggad.' });
    return false;
  }
  async function handler(req, res) {
    requestCount++;
    res.once('finish', () => { if (res.statusCode >= 500) serverErrors++; });
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'same-origin');
    const url = new URL(req.url, 'http://localhost');
    const route = url.pathname;
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (mutating && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return json(res, 403, { error: 'Origin is not allowed' });
    const apiRequest = /^\/(?:api\/|chat\/|cloud\/|online(?:$|\/))/.test(route);
    if (apiRequest && !allowed(req)) return json(res, 429, { error: 'Too many requests; try again shortly' });
    const suppliedDevice = cookieDeviceId(req.headers.cookie);
    const currentDevice = suppliedDevice || deviceCookie(req, res, env);
    const adminRoute = route === '/admin.html' || route.startsWith('/api/admin/');
    const documentRequest = ['GET', 'HEAD'].includes(req.method) && (route === '/' || route === '/join' || route === '/join/' || route.endsWith('.html'));
    const protectedApi = (apiRequest || route === '/suggest') && !adminRoute && !route.startsWith('/api/membership/') && !['/api/moderation/messages', '/api/moderation/push/subscription', '/api/moderation/status', '/api/moderation/flag', '/api/push/vapid-public'].includes(route);
    if (suppliedDevice && !adminRoute && (documentRequest || protectedApi) && await moderation.isBanned(currentDevice)) {
      if (documentRequest) {
        res.writeHead(403, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(req.method === 'HEAD' ? undefined : BLOCKED_HTML);
      }
      return json(res, 403, { banned: true, error: 'This browser is blocked by site moderation.' });
    }
    const publicDocument = route === '/account.html' || route === '/support.html';
    if (documentRequest && !adminRoute && !publicDocument) {
      let account;
      try { account = await memberships.authenticate(req); }
      catch (error) { return json(res, error.status || 503, { error: error.message || 'Medlemskapet kunde inte kontrolleras.' }); }
      if (!account || !memberships.hasAccess(account.user)) {
        res.writeHead(302, { location: '/account.html?status=' + (account ? 'expired' : 'login'), 'cache-control': 'no-store' });
        return res.end();
      }
    }
    if (protectedApi) {
      let account;
      try { account = await memberships.authenticate(req); }
      catch (error) { return json(res, error.status || 503, { error: error.message || 'Medlemskapet kunde inte kontrolleras.' }); }
      if (!account) return json(res, 401, { error: 'Logga in för att använda TR-os.', code: 'membership_login' });
      if (!memberships.hasAccess(account.user)) return json(res, 402, { error: 'Abonnemanget har gått ut. Betala för att få åtkomst igen.', code: 'membership_expired' });
    }
    if (route.startsWith('/api/membership/')) {
      if (!memberships.configured) return json(res, 503, { error: 'Medlemskap kräver en ansluten Redis-databas på servern.' });
      if (route === '/api/membership/me') {
        if (req.method !== 'GET') return json(res, 405, { error: 'Use GET' });
        return json(res, 200, await memberships.summary(req));
      }
      if (route === '/api/membership/register' || route === '/api/membership/login') {
        if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' });
        if (!allowed(req, route.endsWith('/register') ? 'member-register' : 'member-login', 8)) return json(res, 429, { error: 'För många försök. Vänta en minut.' });
        const data = await body(req, 12000);
        const result = route.endsWith('/register') ? await memberships.register(data, req) : await memberships.login(data, req);
        appendCookie(res, memberships.sessionCookie(result.token, req, env));
        const plans = await memberships.getPlans();
        return json(res, route.endsWith('/register') ? 201 : 200, { user: memberships.publicUser(result.user, plans), deviceType: result.deviceType });
      }
      if (route === '/api/membership/logout') {
        if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' });
        await memberships.logout(req);
        appendCookie(res, memberships.clearSessionCookie(req, env));
        return json(res, 200, { ok: true });
      }
      if (route === '/api/membership/payments') {
        if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' });
        const payment = await memberships.createPayment(req);
        return json(res, 201, { payment, swishNumber: memberships.swishNumber });
      }
      const reportPaymentMatch = route.match(/^\/api\/membership\/payments\/([a-f0-9-]{36})\/report$/i);
      if (reportPaymentMatch) {
        if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' });
        const result = await memberships.markPaid(req, reportPaymentMatch[1], await body(req, 4000));
        if (result.notified) {
          const payment = result.payment;
          notify(push.notifyAdmins('Swishbetalning att godkänna', 'Betalare: ' + payment.reportedFirstName + ' ' + payment.reportedLastName + '. Konto: ' + payment.firstName + ' ' + payment.lastName + '. ' + payment.amount + ' kr för ' + payment.durationDays + ' dagar. Referens: ' + payment.reference + '.', '/admin.html#payments-list', 'member-payment-report-' + payment.id));
        }
        return json(res, 200, { payment: result.payment });
      }
      return json(res, 404, { error: 'Not found' });
    }
    if (route === '/api/moderation/status') {
      if (req.method !== 'GET') return json(res, 405, { error: 'Use GET' });
      return json(res, 200, { banned: false, storage: moderation.configured ? 'redis' : 'memory' });
    }
    if (route === '/api/push/vapid-public') {
      if (req.method !== 'GET') return json(res, 405, { error: 'Use GET' });
      try {
        const publicKey = await push.publicKey();
        if (!publicKey) return json(res, 503, { error: 'Pushnotiser kräver den anslutna Redis-databasen.' });
        return json(res, 200, { publicKey });
      } catch { return json(res, 503, { error: 'Pushnotiser kunde inte startas just nu.' }); }
    }
    if (route === '/api/admin/push/subscription') {
      if (!['POST', 'DELETE'].includes(req.method)) return json(res, 405, { error: 'Use POST or DELETE' });
      if (!adminAuthorized(req, res)) return;
      try {
        const data = await body(req, 6000);
        const result = req.method === 'POST' ? await push.registerAdmin(data.subscription) : await push.removeAdmin(data.subscription);
        return json(res, result.ok ? 200 : 400, result);
      } catch { return json(res, 503, { error: 'Pushprenumerationen kunde inte sparas.' }); }
    }
    if (route === '/api/moderation/push/subscription') {
      if (!['POST', 'DELETE'].includes(req.method)) return json(res, 405, { error: 'Use POST or DELETE' });
      if (!(await moderation.isBanned(currentDevice)) && !(await moderation.hasConversation(currentDevice))) return json(res, 403, { error: 'Supportnotiser kräver ett pågående supportärende.' });
      if (!allowed(req, 'moderation-push', 5)) return json(res, 429, { error: 'Vänta lite innan du ändrar notisinställningen.' });
      try {
        const data = await body(req, 6000);
        const result = req.method === 'POST' ? await push.registerBrowser((await moderation.messagesForDevice(currentDevice)).id, data.subscription) : await push.removeBrowser((await moderation.messagesForDevice(currentDevice)).id, data.subscription);
        return json(res, result.ok ? 200 : 400, result);
      } catch { return json(res, 503, { error: 'Pushprenumerationen kunde inte sparas.' }); }
    }
    if (route === '/api/moderation/messages') {
      if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { error: 'Use GET or POST' });
      if (!(await moderation.isBanned(currentDevice)) && !(await moderation.hasConversation(currentDevice))) return json(res, 403, { error: 'Supportchatten är bara tillgänglig för spärrade webbläsare och öppna supportärenden.' });
      if (req.method === 'GET') return json(res, 200, await moderation.messagesForDevice(currentDevice));
      if (!allowed(req, 'moderation-chat', 10)) return json(res, 429, { error: 'Vänta lite innan du skickar ett nytt meddelande.' });
      const data = await body(req, 5000);
      const result = await moderation.sendBrowserMessage(currentDevice, data.text);
      if (!result.ok) return json(res, 400, { error: 'Skriv ett meddelande på högst 2000 tecken.' });
      notify(push.notifyAdmins('Nytt supportmeddelande', 'En besökare har skrivit i supportchatten.', '/admin.html#support', 'support-' + result.message.id));
      return json(res, 201, { ok: true, message: result.message });
    }
    if (route === '/api/moderation/flag') {
      if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' });
      if (!allowed(req, 'moderation', 5)) return json(res, 429, { error: 'Too many moderation events; try again shortly.' });
      const result = await moderation.ban(currentDevice);
      if (!result.ok) return json(res, 503, { error: 'The moderation service is not available.' });
      notify(push.notifyAdmins('Ny spärr', 'En webbläsare har blockerats automatiskt.', '/admin.html#bans', 'ban-' + result.id));
      return json(res, 200, { banned: true, storage: result.source });
    }
    if (route === '/api/admin/moderation/bans') {
      if (req.method !== 'GET') return json(res, 405, { error: 'Use GET' });
      if (!adminAuthorized(req, res)) return;
      return json(res, 200, await moderation.list());
    }
    const unbanMatch = route.match(/^\/api\/admin\/moderation\/bans\/([a-f0-9]{64})$/i);
    if (unbanMatch) {
      if (req.method !== 'DELETE') return json(res, 405, { error: 'Use DELETE' });
      if (!adminAuthorized(req, res)) return;
      const result = await moderation.unban(unbanMatch[1].toLowerCase());
      if (result.source === 'unavailable') return json(res, 503, { error: 'The moderation storage is not available.' });
      if (result.removed) notify(push.notifyBrowser(unbanMatch[1].toLowerCase(), 'Spärren är hävd', 'Du kan använda TR-os igen. Supportchatten finns kvar här.', '/support.html', 'unban'));
      return json(res, 200, result);
    }
    if (route === '/api/admin/moderation/conversations') {
      if (req.method !== 'GET') return json(res, 405, { error: 'Use GET' });
      if (!adminAuthorized(req, res)) return;
      return json(res, 200, await moderation.listConversations());
    }
    if (route === '/api/admin/members/grant-time') {
      if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' });
      if (!adminAuthorized(req, res)) return;
      if (!memberships.configured) return json(res, 503, { error: 'Medlemskap kräver en ansluten Redis-databas på servern.' });
      const data = await body(req, 4000);
      const updated = await memberships.addTimeToExpiredUsers(data.days, data.hours);
      return json(res, 200, { updated });
    }
    if (route === '/api/admin/members' || route === '/api/admin/members/plans') {
      if (!adminAuthorized(req, res)) return;
      if (!memberships.configured) return json(res, 503, { error: 'Medlemskap kräver en ansluten Redis-databas på servern.' });
      if (route.endsWith('/plans')) {
        if (req.method === 'GET') return json(res, 200, { plans: await memberships.getPlans() });
        if (req.method !== 'PUT') return json(res, 405, { error: 'Use GET or PUT' });
        return json(res, 200, { plans: await memberships.updatePlans((await body(req, 20000)).plans) });
      }
      if (req.method === 'GET') {
        const [users, payments, plans] = await Promise.all([memberships.listUsers(), memberships.listPayments(), memberships.getPlans()]);
        return json(res, 200, { users, payments, plans, swishNumber: memberships.swishNumber });
      }
      if (req.method !== 'POST') return json(res, 405, { error: 'Use GET or POST' });
      const created = await memberships.adminCreateUser(await body(req, 12000));
      return json(res, 201, { user: memberships.publicUser(created, await memberships.getPlans()) });
    }
    const adminMemberMatch = route.match(/^\/api\/admin\/members\/([a-f0-9-]{36})(?:\/(reset-devices|add-time))?$/i);
    if (adminMemberMatch) {
      if (!adminAuthorized(req, res)) return;
      if (!memberships.configured) return json(res, 503, { error: 'Medlemskap kräver en ansluten Redis-databas på servern.' });
      if (adminMemberMatch[2]) {
        if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' });
        if (adminMemberMatch[2] === 'reset-devices') {
          await memberships.resetDevices(adminMemberMatch[1]);
          return json(res, 200, { ok: true });
        }
        const data = await body(req, 4000);
        const result = await memberships.addTime(adminMemberMatch[1], data.days, data.hours);
        return json(res, 200, result);
      }
      if (req.method !== 'PATCH') return json(res, 405, { error: 'Use PATCH' });
      return json(res, 200, { user: await memberships.updateUser(adminMemberMatch[1], await body(req, 8000)) });
    }
    const adminPaymentMatch = route.match(/^\/api\/admin\/payments\/([a-f0-9-]{36})\/confirm$/i);
    if (adminPaymentMatch) {
      if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' });
      if (!adminAuthorized(req, res)) return;
      if (!memberships.configured) return json(res, 503, { error: 'Medlemskap kräver en ansluten Redis-databas på servern.' });
      const result = await memberships.confirmPayment(adminPaymentMatch[1]);
      notify(push.notifyAdmins('Swishbetalning godkänd', result.payment.firstName + ' ' + result.payment.lastName + ' · ' + result.payment.amount + ' kr.', '/admin.html#members', 'member-payment-approved-' + result.payment.id));
      return json(res, 200, result);
    }
    const conversationMatch = route.match(/^\/api\/admin\/moderation\/conversations\/([a-f0-9]{64})\/messages$/i);
    if (conversationMatch) {
      if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' });
      if (!adminAuthorized(req, res)) return;
      if (!allowed(req, 'admin-support-chat', 30)) return json(res, 429, { error: 'Vänta lite innan du svarar igen.' });
      const data = await body(req, 5000);
      const deviceId = conversationMatch[1].toLowerCase();
      const result = await moderation.sendAdminMessage(deviceId, data.text);
      if (!result.ok) return json(res, 400, { error: 'Skriv ett meddelande på högst 2000 tecken.' });
      notify(push.notifyBrowser(deviceId, 'Svar från TR-os admin', 'Administratören har svarat i supportchatten.', '/support.html', 'admin-reply-' + result.message.id));
      return json(res, 201, { ok: true, message: result.message });
    }
    if (route === '/api/admin/snapchat' || route === '/api/admin/snapchat/stop' || route === '/api/admin/snapchat/forget') {
      return json(res, 410, { error: 'Snapchat-testet är borttaget.' });
    }
    if (route === '/api/admin/status') {
      if (req.method !== 'GET') return json(res, 405, { error: 'Use GET' });
      if (!adminAuthorized(req, res)) return;
      const [livePresence, trafficStats] = await Promise.all([presence.snapshot(), traffic.snapshot()]);
      return json(res, 200, {
        checkedAt: new Date().toISOString(), startedAt: new Date(startedAt).toISOString(),
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        activeSessions: livePresence.presence.source === 'redis' ? livePresence.online : null, recentVisitors: livePresence.recentVisitors, localSessions: activeCount(), presence: livePresence.presence, websocketConnections: sockets.size,
        requests: requestCount, serverErrors, memoryMB: Math.round(process.memoryUsage().rss / 1048576),
        traffic: trafficStats,
        scope: livePresence.presence.source === 'redis' ? 'Aktiva webbläsare räknas gemensamt i Redis över alla serverinstanser. Flera flikar i samma webbläsare räknas en gång. Aktiv = livssignal under de senaste 90 sekunderna. Övriga driftvärden gäller denna serverinstans.' : 'Gemensam besöksräkning är inte tillgänglig. Ingen lokal siffra visas som globalt antal. Övriga driftvärden gäller denna serverinstans.',
        services: {
          server: 'Tillgänglig', database: livePresence.presence.source === 'redis' ? 'Redis ansluten · gemensam närvaro' : livePresence.presence.source === 'unavailable' ? 'Databasen svarar inte' : 'Gemensam databas inte ansluten', proxy: 'Egen Wisp-server aktiverad; externa mål kan neka åtkomst',
          ai: env.AI_URL ? 'Eget server-API konfigurerat; svar inte verifierat här' : 'Lokal AI och offentligt externt AI-alternativ i chatten',
          vpn: env.VPN_API_URL && env.VPN_WISP_URL ? 'VPN-backend konfigurerad; tunnel inte verifierad här' : 'Ingen egen VPN-tunnel ansluten',
          movies: env.TMDB_KEY ? 'Filmmetadata konfigurerad; uppspelning beror på extern källa' : 'Ingen egen TMDB-nyckel konfigurerad',
          cloud: 'Extern Cloud-spelare; ingen egen spelserver', chat: 'Egen chatt och närvaro aktiverad'
        }
      });
    }
    if (route === '/api/reports') {
      if (req.method !== 'POST') return json(res, 405, {error:'Use POST'});
      if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return json(res,415,{error:'Use application/json'});
      if (!allowed(req,'reports',5)) return json(res,429,{error:'För många rapporter. Försök senare.'});
      const result = await reports.submit(await body(req,150000));
      notify(push.notifyAdmins('Ny felrapport', 'En besökare har rapporterat ett fel.', '/admin.html#reports', 'report-' + (result.id || Date.now())));
      return json(res,201,result);
    }
    if (route === '/api/admin/reports' || route.startsWith('/api/admin/reports/')) {
      if (!adminAuthorized(req,res)) return;
      if (route === '/api/admin/reports') {
        if (req.method !== 'GET') return json(res,405,{error:'Use GET'});
        return json(res,200,await reports.list());
      }
      const seen=route.match(/^\/api\/admin\/reports\/([a-f0-9-]{36})\/seen$/i);
      if (seen) {
        if (req.method !== 'POST') return json(res,405,{error:'Use POST'});
        return json(res,200,await reports.archive(seen[1]));
      }
      if (req.method !== 'GET') return json(res,405,{error:'Use GET'});
      const match=route.match(/^\/api\/admin\/reports\/([a-f0-9-]{36})\/image$/i);
      if (!match) return json(res,404,{error:'Not found'});
      const image=await reports.image(match[1]);
      res.writeHead(200,{'content-type':'image/jpeg','cache-control':'no-store','content-length':image.length,'content-disposition':'inline; filename="report.jpg"'});
      return res.end(image);
    }
    if (route === '/api/health') return json(res, 200, {
      ok: true, name: 'TR-os', services: {
        proxy: true, chat: true, online: true,
        ai: env.AI_URL ? 'remote' : env.VERCEL ? 'unconfigured' : 'local-ollama', cloud: !!env.CLOUD_API_URL,
        vpn: !!env.VPN_API_URL && !!env.VPN_WISP_URL, cheats: !!env.JOIN_URL
      }
    });
    if (route === '/tr-os.config.js') {
      res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
      return res.end('window.TR_OS_CONFIG = ' + JSON.stringify({ apiBase: '', wispBase: '', aiUrl: '/api/ai', hasBackend: true, cloudKeyOnServer: !!env.CLOUD_API_KEY, cloudConfigured: !!env.CLOUD_API_URL, vpnConfigured: !!env.VPN_API_URL && !!env.VPN_WISP_URL, proxyProvider: env.PROXY_PROVIDER || (env.PROXY_WISP_URL ? 'custom' : 'direct') }) + ';');
    }
    if (route === '/online') {
      if (req.method === 'GET') return json(res, 200, await presence.snapshot());
      if (req.method !== 'POST') return json(res, 405, { error: 'Use GET or POST' });
      const member = await memberships.authenticate(req);
      if (!member || !memberships.hasAccess(member.user)) return json(res, 402, { error: 'Aktivt medlemskap krävs.', code: 'membership_expired' });
      const data = await body(req);
      let user = authenticated(data.token, data.secret);
      // A closing tab must not remove another tab using the same browser ID.
      if (data.leave) return json(res, 200, await presence.snapshot());
      if (!user) {
        if (sessions.size >= 10000) return json(res, 503, { error: 'Server is busy' });
        const token = crypto.randomUUID();
        user = { token, secret: crypto.randomBytes(32).toString('hex'), name: member.user.firstName + ' ' + member.user.lastName, seen: Date.now() };
        sessions.set(token, user);
      }
      user.name = member.user.firstName + ' ' + member.user.lastName;
      user.seen = Date.now();
      broadcast();
      const [livePresence, trafficStats] = await Promise.all([presence.snapshot(data.visitorId), traffic.snapshot(data.visitorId, data.viewId)]);
      return json(res, 200, { token: user.token, secret: user.secret, ...livePresence, trafficRecorded: trafficStats.source === 'redis', banned: false });
    }
    if (route === '/chat/room' && req.method === 'GET') return json(res, 200, { messages: messages.filter(m => m.to === 'all' && m.ts > Number(url.searchParams.get('since') || 0)).slice(-100) });
    if (route === '/chat/inbox' && req.method === 'GET') {
      const user = authenticated(url.searchParams.get('token'), url.searchParams.get('secret'));
      if (!user) return json(res, 401, { error: 'Session expired; reload the page' });
      return json(res, 200, { messages: messages.filter(m => m.to === user.token && m.ts > Number(url.searchParams.get('since') || 0)).slice(-100) });
    }
    if (route === '/chat/send' && req.method === 'POST') {
      const data = await body(req), user = authenticated(data.from, data.secret);
      if (!user) return json(res, 401, { error: 'Session expired; reload the page' });
      if (!allowed(req, 'chat', 30)) return json(res, 429, { error: 'Please wait before sending more messages' });
      const text = typeof data.text === 'string' ? data.text.trim() : '';
      if (!text || text.length > 4000 || (data.to !== 'all' && !sessions.has(data.to))) return json(res, 400, { error: 'Invalid message or recipient' });
      const message = { id: crypto.randomUUID(), from: user.token, fromName: user.name, to: data.to, text, ts: nowStamp() };
      messages.push(message);
      if (messages.length > 1000) messages.shift();
      return json(res, 200, { ok: true, id: message.id });
    }
    if (route === '/party') return json(res, 200, { disco: false, track: null, bg: null });
    if (route === '/suggest' && req.method === 'GET') {
      const query = (url.searchParams.get('q') || '').slice(0, 200);
      if (!query) return json(res, 200, { list: [] });
      if (detectsAdultSearch(query)) {
        // Do not forward adult searches to DuckDuckGo. Only the random device
        // ID hash, timestamp, and fixed moderation reason are retained.
        const result = await moderation.ban(currentDevice);
        if (!result.ok) return json(res, 503, { error: 'The moderation service is not available.' });
        notify(push.notifyAdmins('Ny spärr', 'En webbläsare har blockerats automatiskt.', '/admin.html#bans', 'ban-' + result.id));
        return json(res, 403, { banned: true, error: 'This browser is blocked by site moderation.' });
      }
      try {
        const response = await fetch('https://ac.duckduckgo.com/ac/?q=' + encodeURIComponent(query) + '&type=list', { signal: AbortSignal.timeout(4000) });
        const suggestions = await response.json();
        const list = Array.isArray(suggestions[1]) ? suggestions[1] : suggestions.map(item => item.phrase).filter(Boolean);
        return json(res, 200, { list: list.slice(0, 8) });
      } catch { return json(res, 200, { list: [] }); }
    }
    if (route === '/chat/log' || route === '/api/mullvad/log') { res.writeHead(204); return res.end(); }
    if (route === '/api/redeem/verify') return json(res, 200, { valid: false, unlimited: false });
    if (route === '/api/ai' || route === '/api/nvidia/chat') {
      if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' });
      if (!allowed(req, 'ai', 15)) return json(res, 429, { error: 'Please wait before sending more requests' });
      const data = await body(req, 8 * 1024 * 1024);
      const validContent = content => typeof content === 'string' || (Array.isArray(content) && content.length <= 32 && content.every(part => part && (part.type === 'text' ? typeof part.text === 'string' : part.type === 'image_url' && typeof part.image_url?.url === 'string' && /^data:image\/(?:png|jpeg|webp|gif);base64,/.test(part.image_url.url))));
      if (!Array.isArray(data.messages) || data.messages.length > 100 || data.messages.some(m => !['user', 'assistant', 'system'].includes(m.role) || !validContent(m.content))) return json(res, 400, { error: 'Invalid chat messages' });
      if (env.AI_URL) return relay(res, configuredUrl(env.AI_URL, ''), { method: 'POST', headers: { 'content-type': 'application/json', ...(env.AI_KEY ? { authorization: 'Bearer ' + env.AI_KEY } : {}) }, body: JSON.stringify({ model: env.AI_MODEL || data.model, messages: data.messages, stream: !!data.stream }) });
      if (env.VERCEL) return json(res, 503, { error: 'AI är inte ansluten ännu. En AI-tjänst behöver konfigureras för TR-os i Vercel.' });
      // Ollama runs locally; request a regular OpenAI-compatible response for
      // the frontend's non-stream fallback. No simulated AI replies are used.
      try {
        const localMessages = data.messages.map(message => Array.isArray(message.content) ? {
          role: message.role,
          content: message.content.filter(part => part.type === 'text').map(part => part.text).join('\n'),
          images: message.content.filter(part => part.type === 'image_url').map(part => part.image_url.url.split(',')[1])
        } : message);
        const upstream = await fetch(configuredUrl(env.OLLAMA_URL || 'http://127.0.0.1:11434', '/api/chat'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: env.OLLAMA_MODEL || 'llama3.2', messages: localMessages, stream: false }), signal: AbortSignal.timeout(90000) });
        const result = await upstream.json();
        if (!upstream.ok) return json(res, 503, { error: result.error || 'Local AI model is unavailable' });
        return json(res, 200, { choices: [{ message: { role: 'assistant', content: result.message?.content || '' } }] });
      } catch { return json(res, 503, { error: 'Connect an AI service or start Ollama with the configured model.' }); }
    }
    if (route === '/api/cloud/status') {
      if (!env.CLOUD_API_URL) return json(res, 200, { configured: false, available: false, keyRequired: false });
      let available = false;
      try {
        const response = await fetch(configuredUrl(env.CLOUD_API_URL, '/cloud/v1/'), { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(5000) });
        available = response.status < 500;
        await response.body?.cancel();
      } catch {}
      return json(res, 200, { configured: true, available, keyRequired: !env.CLOUD_API_KEY });
    }
    if (route.startsWith('/cloud/v1/')) {
      if (!env.CLOUD_API_URL) return json(res, 503, { error: 'Connect your cloud-gaming provider to start a session.' });
      const headers = { 'content-type': req.headers['content-type'] || 'application/json' };
      const key = env.CLOUD_API_KEY || req.headers['x-api-key'];
      if (key) headers['x-api-key'] = key;
      try {
        return await relay(res, configuredUrl(env.CLOUD_API_URL, route + url.search), { method: req.method, headers, ...(mutating ? { body: JSON.stringify(await body(req)) } : {}) });
      } catch (error) {
        if (error.status) throw error;
        return json(res, 503, { error: 'The cloud service could not be reached. Please try again later.' });
      }
    }
    if (route.startsWith('/api/mullvad/')) {
      if (env.VPN_API_URL) return relay(res, configuredUrl(env.VPN_API_URL, route + url.search), { method: req.method, headers: { 'content-type': 'application/json' }, ...(mutating ? { body: JSON.stringify(await body(req)) } : {}) });
      if (route.endsWith('/relays')) return json(res, 200, { relays: [], active: 'vps', vpn: false });
      if (route.endsWith('/status')) return json(res, 200, { relay: 'vps', vpn: false, city: '', country: 'Direct proxy', exit_ip: null });
      return json(res, 503, { error: 'No VPN service connected. Direct proxy is available.' });
    }
    if (route.startsWith('/api/tmdb-img/')) return relay(res, 'https://image.tmdb.org/' + route.slice('/api/tmdb-img/'.length) + url.search);
    if (route.startsWith('/api/tmdb/')) {
      const target = new URL('https://api.themoviedb.org/3/' + route.slice('/api/tmdb/'.length) + url.search);
      if (env.TMDB_API_KEY) target.searchParams.set('api_key', env.TMDB_API_KEY);
      return relay(res, target);
    }
    if (route === '/join' || route === '/join/') {
      if (env.JOIN_URL) { res.writeHead(302, { location: configuredUrl(env.JOIN_URL, '').href }); return res.end(); }
      res.writeHead(302, { location: '/cheats.html' });
      return res.end();
    }
    if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Method is not allowed' });
    let decoded;
    try { decoded = decodeURIComponent(route); } catch { return json(res, 400, { error: 'Invalid path' }); }
    if (decoded.split(/[\\/]/).some(part => part.startsWith('.') || ['node_modules', 'data', 'tests', 'api', 'scripts'].includes(part))) return json(res, 404, { error: 'Not found' });
    let file = path.resolve(root, '.' + decoded);
    if (!file.startsWith(root + path.sep) && file !== root) return json(res, 404, { error: 'Not found' });
    try { if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html'); } catch { return json(res, 404, { error: 'Not found' }); }
    const types = { '.html': 'text/html; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.cur': 'image/x-icon', '.ani': 'application/octet-stream', '.woff2': 'font/woff2' };
    const type = types[path.extname(file)];
    if (!type || !fs.existsSync(file)) return json(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache', ...(file.endsWith('sw.js') ? { 'service-worker-allowed': '/' } : {}) });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  }
  const server = http.createServer((req, res) => handler(req, res).catch(error => {
    if (res.headersSent) return res.destroy();
    json(res, error.status || 502, { error: error.status ? error.message : 'The connected service could not be reached.' });
  }));
  const chatWs = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  const proxyWs = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
  chatWs.on('connection', socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    socket.send(JSON.stringify({ online: activeCount() }));
    socket.on('message', message => {
      if (message.toString() === 'ping') socket.send(JSON.stringify({ online: activeCount() }));
    });
  });
  wisp.options.allow_private_ips = false;
  wisp.options.allow_loopback_ips = false;
  wisp.options.port_whitelist = [80, 443];
  function relayWisp(req, socket, head, target) {
    const upstream = new WebSocket(target);
    const timer = setTimeout(() => { upstream.terminate(); socket.destroy(); }, 10000);
    socket.once('close', () => upstream.terminate());
    upstream.on('error', () => { clearTimeout(timer); socket.destroy(); });
    upstream.on('open', () => {
      clearTimeout(timer);
      proxyWs.handleUpgrade(req, socket, head, client => {
        sockets.add(client);
        client.on('message', (data, binary) => { if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary }); });
        upstream.on('message', (data, binary) => { if (client.readyState === WebSocket.OPEN) client.send(data, { binary }); });
        client.on('close', () => { sockets.delete(client); upstream.close(); });
        client.on('error', () => upstream.close());
        upstream.on('close', () => client.close());
      });
    });
  }
  server.on('upgrade', async (req, socket, head) => {
    socket.on('error', () => {});
    if (req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.headers.host) return socket.destroy(); }
      catch { return socket.destroy(); }
    }
    if (await moderation.isBanned(cookieDeviceId(req.headers.cookie))) {
      return socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    }
    let member;
    try { member = await memberships.authenticate(req); }
    catch { return socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); }
    if (!member || !memberships.hasAccess(member.user)) {
      return socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    }
    const route = new URL(req.url, 'http://localhost').pathname;
    if (route === '/tros-ws') return chatWs.handleUpgrade(req, socket, head, ws => chatWs.emit('connection', ws, req));
    // Movie playback must not depend on the reference site's VPN being online.
    if (route === '/wisp-movies/') return wisp.routeRequest(req, socket, head);
    if (route === '/wisp-vps/') {
      if (env.PROXY_WISP_URL) return relayWisp(req, socket, head, env.PROXY_WISP_URL);
      return wisp.routeRequest(req, socket, head);
    }
    if (/^\/wisp-mullvad(?:-(?:us|eu|se))?\/$/.test(route) && env.VPN_WISP_URL) {
      return relayWisp(req, socket, head, env.VPN_WISP_URL);
    }
    socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
  });
  const cleanup = setInterval(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [key, value] of sessions) if (value.seen < cutoff) sessions.delete(key);
    for (const [key, value] of limits) if (value.until < Date.now()) limits.delete(key);
    while (messages.length && messages[0].ts < cutoff) messages.shift();
  }, 60000);
  cleanup.unref();
  server.on('close', () => { clearInterval(cleanup); chatWs.close(); proxyWs.close(); });
  return { server, close: () => { for (const socket of sockets) socket.terminate(); server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); } };
}

function start() {
  if (typeof process.loadEnvFile === 'function') { try { process.loadEnvFile(path.join(__dirname, '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  const app = createApp({ env: proxyEnvironment(process.env) });
  app.server.listen(Number(process.env.PORT || 8173), process.env.HOST || '127.0.0.1', () => console.log('TR-os: http://localhost:' + app.server.address().port));
  return app;
}
module.exports = { createApp, start, proxyEnvironment };
if (require.main === module) start();
