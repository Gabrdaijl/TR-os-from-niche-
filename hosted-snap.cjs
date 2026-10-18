'use strict';
const crypto = require('node:crypto');
const { WebSocket } = require('ws');

const MAX_STARTS = 10;
const SESSION_SECONDS = 240;
const RESERVE = `if #KEYS==3 and redis.call('EXISTS',KEYS[3])==1 then return {-2,0} end
if redis.call('EXISTS',KEYS[1])==1 then return {0,0} end
local used=tonumber(redis.call('GET',KEYS[2]) or '0')
if used>=tonumber(ARGV[2]) then return {-1,used} end
redis.call('SET',KEYS[1],ARGV[1],'EX',300)
return {1,redis.call('INCR',KEYS[2])}`;
const UNLOCK = `if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0`;
class SafeError extends Error {
  constructor(message, status = 503) { super(message); this.status = status; }
}

// This handler is deliberately admin-only: the caller must authenticate before calling it.
// Reserve four minutes for every attempt, including failures, against a lifetime free-test budget.
function createHostedSnap({ env, fetchImpl = fetch, WebSocketImpl = WebSocket }) {
  const project = env.BROWSERBASE_PROJECT_ID;
  const apiKey = env.BROWSERBASE_API_KEY;
  const redisUrl = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const redisToken = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  const scope = crypto.createHash('sha256').update(project || '').digest('hex');
  const lockKey = 'tros:snap:hosted:v1:' + scope + ':lock';
  const budgetKey = 'tros:snap:hosted:v1:' + scope + ':starts';
  const deviceCookieName = env.VERCEL ? '__Host-tros-snap-device' : 'tros_snap_device';
  const profileKey = device => 'tros:snap:profile:v1:' + scope + ':' + crypto.createHash('sha256').update(device).digest('hex');
  const validId = id => typeof id === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(id);
  function deviceCookie(req) {
    const raw = req.headers?.cookie;
    if (!raw) return null;
    if (typeof raw !== 'string') throw new SafeError('Enhetens profilkod är ogiltig.', 400);
    const values = raw.split(';').map(value => value.trim()).filter(value => value.startsWith(deviceCookieName + '='));
    if (!values.length) return null;
    if (values.length !== 1 || !new RegExp('^' + deviceCookieName + '=[a-f0-9]{64}$', 'i').test(values[0])) throw new SafeError('Enhetens profilkod är ogiltig.', 400);
    return values[0].slice(deviceCookieName.length + 1).toLowerCase();
  }
  function setDeviceCookie(res, device, forget = false) {
    if (res.destroyed || res.writableEnded) return;
    res.setHeader('set-cookie', deviceCookieName + '=' + device + '; Path=' + (env.VERCEL ? '/' : '/api/admin/snapchat') + '; HttpOnly; SameSite=Strict; Max-Age=' + (forget ? '0' : '31536000') + (env.VERCEL ? '; Secure' : ''));
  }
  function clientToken(req) {
    const value = req.headers?.['x-tros-snap-stop'];
    return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null;
  }
  function ownerKeys(owner) {
    const prefix = 'tros:snap:hosted:v1:' + scope + ':' + crypto.createHash('sha256').update(owner).digest('hex');
    return { session: prefix + ':session', cancel: prefix + ':cancel', profile: prefix + ':profile' };
  }
  function reply(res, status, data) {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(data));
  }

  async function request(url, init, signal, message) {
    try {
      const response = await fetchImpl(url, {
        ...init, redirect: 'error',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(5000)
      });
      if (!response.ok) throw Error('Upstream rejected request');
      if (response.status === 204) return null;
      return await response.json();
    } catch { throw new SafeError(message); }
  }
  function api(route, data, signal) {
    return request('https://api.browserbase.com/v1/sessions' + route, {
      method: data ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', 'X-BB-API-Key': apiKey },
      ...(data ? { body: JSON.stringify(data) } : {})
    }, signal, 'Den hostade webbläsaren svarar inte. Testet kan vara upptaget eller gratiskvoten slut.');
  }
  function contexts(route, data, signal, method = 'POST') {
    return request('https://api.browserbase.com/v1/contexts' + route, {
      method, headers: { 'content-type': 'application/json', 'X-BB-API-Key': apiKey },
      ...(data ? { body: JSON.stringify(data) } : {})
    }, signal, 'Enhetsprofilen stöds inte eller kunde inte anslutas just nu. Ingen betalplan aktiveras.');
  }
  async function redis(command, signal) {
    const endpoint = new URL(redisUrl);
    if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(endpoint.hostname))) throw new SafeError('Testets databas är felkonfigurerad.');
    const result = await request(endpoint, {
      method: 'POST', headers: { authorization: 'Bearer ' + redisToken, 'content-type': 'application/json' },
      body: JSON.stringify(command)
    }, signal, 'Testets databas svarar inte. Ingen ny webbläsare startades.');
    if (result.error || !Object.hasOwn(result, 'result')) throw new SafeError('Testets databas svarar inte.');
    return result.result;
  }
  function validLiveUrl(raw) {
    let url;
    try { url = new URL(raw); } catch { throw new SafeError('Webbläsarens visningslänk kunde inte valideras.'); }
    if (url.protocol !== 'https:' || !['browserbase.com', 'www.browserbase.com'].includes(url.hostname) || url.username || url.password) throw new SafeError('Webbläsarens visningslänk kunde inte valideras.');
    let decoded = url.href;
    for (let n = 0; n < 3; n++) { try { decoded = decodeURIComponent(decoded); } catch { break; } }
    if (/[?&](?:apikey|api_key)=/i.test(decoded) || (apiKey.length >= 8 && decoded.includes(apiKey))) throw new SafeError('Webbläsarens visningslänk innehöll otillåten anslutningsinformation.');
    url.searchParams.set('navbar', 'false');
    return url.href;
  }

  async function handle(req, res) {
    const fail = (status, message) => reply(res, status, { error: message });
    if (req.method !== 'POST') return fail(405, 'Använd POST för att starta testet.');
    if (!apiKey || !project || !redisUrl || !redisToken) return fail(503, 'Det privata webbläsartestet är inte anslutet.');
    if (req.headers?.['x-tros-snap-stop'] !== undefined && !clientToken(req)) return fail(400, 'Testets avslutningskod är ogiltig.');
    const remember = req.headers?.['x-tros-snap-remember'] === '1';
    let device;
    try { if (remember) device = deviceCookie(req) || crypto.randomBytes(32).toString('hex'); }
    catch (error) { return fail(error.status, error.message); }

    const life = new AbortController();
    const deadline = Date.now() + SESSION_SECONDS * 1000;
    const stop = reason => { if (!life.signal.aborted) life.abort(reason); };
    const disconnected = () => stop(new SafeError('Testet avslutades.'));
    const timer = setTimeout(() => stop(new SafeError('Gratisprovet avslutades efter fyra minuter.')), SESSION_SECONDS * 1000);
    timer.unref?.();
    res.once('close', disconnected);
    req.once('aborted', disconnected);
    const owner = clientToken(req) || crypto.randomBytes(32).toString('hex');
    const keys = ownerKeys(owner);
    const cooldown = remember ? profileKey(device) + ':cooldown' : null;
    const checkCancelled = async () => {
      if (await redis(['GET', keys.cancel], life.signal)) throw new SafeError('Testet avslutades.');
    };
    let reserved = false, sessionId, ws, streaming = false;
    const pending = new Map();
    life.signal.addEventListener('abort', () => {
      for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(life.signal.reason); }
      pending.clear();
    }, { once: true });
    let nextId = 0;
    const send = value => { if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify(value) + '\n'); };
    const aborted = () => new Promise(resolve => {
      if (life.signal.aborted) resolve();
      else life.signal.addEventListener('abort', resolve, { once: true });
    });
    try {
      const reservation = await redis(['EVAL', RESERVE, cooldown ? 3 : 2, lockKey, budgetKey, ...(cooldown ? [cooldown] : []), owner, MAX_STARTS], life.signal);
      if (!Array.isArray(reservation) || reservation.length !== 2 || ![0, 1, -1, -2].includes(reservation[0]) || !Number.isSafeInteger(reservation[1])) throw new SafeError('Testets databas gav ett ogiltigt svar.');
      if (reservation[0] === -2) throw new SafeError('Profilen sparas. Vänta några sekunder och försök igen.', 409);
      if (reservation[0] === 0) throw new SafeError('Ett privat webbläsartest körs redan. Vänta tills det avslutas.', 409);
      if (reservation[0] === -1) throw new SafeError('Gratisprovets tio starter är förbrukade. Inga betalda starter görs.', 429);
      reserved = true;
      if (life.signal.aborted) throw life.signal.reason;
      await checkCancelled();
      let context;
      if (remember) {
        const key = profileKey(device);
        let id = await redis(['GET', key], life.signal);
        if (!id) {
          const created = await contexts('', { projectId: project }, life.signal);
          if (!validId(created?.id)) throw new SafeError('Enhetsprofilen kunde inte skapas säkert. Ingen betalplan aktiveras.');
          id = created.id;
          try { await redis(['SET', key, id], life.signal); }
          catch (error) {
            // A new, unused profile must not be orphaned if its device mapping cannot be saved.
            try { await contexts('/' + encodeURIComponent(id), null, null, 'DELETE'); } catch {}
            throw error;
          }
        }
        if (!validId(id)) throw new SafeError('Enhetsprofilens koppling är ogiltig.');
        context = { id, persist: true };
        setDeviceCookie(res, device);
      }
      await checkCancelled();
      const session = await api('', {
        projectId: project, timeout: SESSION_SECONDS,
        browserSettings: {
          recordSession: false, logSession: false, solveCaptchas: false,
          advancedStealth: false, verified: false, ignoreCertificateErrors: false,
          viewport: { width: 1280, height: 800 },
          ...(context ? { context } : {})
        }
      }, life.signal);
      if (typeof session.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(session.id)) throw new SafeError('Webbläsaren kunde inte startas säkert.');
      sessionId = session.id;
      if (cooldown) await redis(['SET', keys.profile, cooldown, 'EX', 300], life.signal);
      await redis(['SET', keys.session, sessionId, 'EX', 300], life.signal);
      await checkCancelled();
      let connect;
      try { connect = new URL(session.connectUrl); } catch { throw new SafeError('Webbläsarens anslutning är ogiltig.'); }
      if (connect.protocol !== 'wss:' || !(connect.hostname === 'connect.browserbase.com' || connect.hostname.endsWith('.browserbase.com')) || connect.username || connect.password) throw new SafeError('Webbläsarens anslutning är ogiltig.');
      if (life.signal.aborted) throw life.signal.reason;
      ws = new WebSocketImpl(connect.href, { handshakeTimeout: 8000 });
      ws.on('error', () => stop(new SafeError('Anslutningen till webbläsaren avbröts.')));
      ws.on('close', () => stop(new SafeError('Den hostade webbläsaren avslutades.')));
      ws.on('message', raw => {
        let data;
        try { data = JSON.parse(String(raw)); } catch { return; }
        const entry = pending.get(data.id);
        if (!entry) return;
        pending.delete(data.id);
        clearTimeout(entry.timer);
        data.error ? entry.reject(new SafeError('Webbläsaren kunde inte öppna Snapchat.')) : entry.resolve(data.result);
      });
      await new Promise((resolve, reject) => {
        const opened = () => { cleanup(); resolve(); };
        const stopped = () => { cleanup(); reject(life.signal.reason); };
        const timeout = setTimeout(() => { cleanup(); reject(new SafeError('Anslutningen till webbläsaren tog för lång tid.')); }, 8000);
        const cleanup = () => { clearTimeout(timeout); ws.off('open', opened); life.signal.removeEventListener('abort', stopped); };
        ws.once('open', opened);
        life.signal.addEventListener('abort', stopped, { once: true });
        if (life.signal.aborted) stopped();
      });
      const rpc = (method, params) => new Promise((resolve, reject) => {
        const id = ++nextId;
        const timeout = setTimeout(() => { pending.delete(id); reject(new SafeError('Webbläsaren svarade inte i tid.')); }, 8000);
        pending.set(id, { resolve, reject, timer: timeout });
        try { ws.send(JSON.stringify({ id, method, params })); }
        catch { clearTimeout(timeout); pending.delete(id); reject(new SafeError('Webbläsaren kunde inte öppna Snapchat.')); }
      });
      const target = await rpc('Target.createTarget', { url: 'https://web.snapchat.com/' });
      if (!target || typeof target.targetId !== 'string') throw new SafeError('Snapchat-fönstret kunde inte öppnas.');
      let page;
      for (let attempt = 0; attempt < 3 && !page; attempt++) {
        const links = await api('/' + encodeURIComponent(sessionId) + '/debug?expiresIn=' + SESSION_SECONDS, null, life.signal);
        page = Array.isArray(links.pages) ? links.pages.find(page => page.id === target.targetId) : null;
        if (!page && attempt < 2) await new Promise(resolve => setTimeout(resolve, 200));
      }
      const liveUrl = validLiveUrl(page?.debuggerFullscreenUrl);
      await checkCancelled();
      if (life.signal.aborted) throw life.signal.reason;
      res.writeHead(200, {
        'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store',
        'x-content-type-options': 'nosniff', 'x-accel-buffering': 'no'
      });
      streaming = true;
      // The response remains open to own the CDP connection on the Free plan.
      const providerExpiry = Date.parse(session.expiresAt);
      const expiresAt = new Date(Math.min(deadline, Number.isFinite(providerExpiry) ? providerExpiry : Infinity)).toISOString();
      send({ type: 'ready', url: liveUrl, expiresAt });
      await aborted();
      send({ type: 'ended', message: life.signal.reason?.message || 'Testet avslutades.' });
    } catch (error) {
      const safe = error instanceof SafeError ? error : new SafeError('Webbläsartestet kunde inte startas.');
      if (streaming) send({ type: 'error', message: safe.message });
      else fail(safe.status, safe.message);
    } finally {
      clearTimeout(timer);
      res.off('close', disconnected);
      req.off('aborted', disconnected);
      for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new SafeError('Testet avslutades.')); }
      pending.clear();
      let released = !sessionId;
      if (sessionId) { try { await api('/' + encodeURIComponent(sessionId), { status: 'REQUEST_RELEASE' }); released = true; } catch {} }
      // Keep the CDP owner connected until release is accepted. Closing it first can
      // end the provider session and make an otherwise valid release look like a failure.
      try { ws?.terminate(); } catch {}
      if (released && sessionId && cooldown) {
        try { await redis(['SET', cooldown, '1', 'EX', 8]); }
        catch { released = false; }
      }
      if (reserved && released) {
        try { await redis(['DEL', keys.session, keys.cancel, keys.profile]); } catch {}
        try { await redis(['EVAL', UNLOCK, 1, lockKey, owner]); } catch {}
      }
      if (!res.destroyed && !res.writableEnded) res.end();
    }
  }
  async function stop(req, res) {
    if (req.method !== 'POST') return reply(res, 405, { error: 'Använd POST för att avsluta testet.' });
    if (!apiKey || !project || !redisUrl || !redisToken) return reply(res, 503, { error: 'Det privata webbläsartestet är inte anslutet.' });
    const owner = clientToken(req);
    if (!owner) return reply(res, 400, { error: 'Testets avslutningskod saknas eller är ogiltig.' });
    const keys = ownerKeys(owner);
    try {
      // Retain cancellation through the create/map race. The owner handler removes it.
      await redis(['SET', keys.cancel, '1', 'EX', 300]);
      const sessionId = await redis(['GET', keys.session]);
      if (!sessionId) return reply(res, 202, { ok: true, pending: true });
      if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(sessionId)) throw new SafeError('Testets anslutning kunde inte valideras.');
      await api('/' + encodeURIComponent(sessionId), { status: 'REQUEST_RELEASE' });
      const cooldown = await redis(['GET', keys.profile]);
      if (cooldown) {
        if (typeof cooldown !== 'string' || !new RegExp('^tros:snap:profile:v1:' + scope + ':[a-f0-9]{64}:cooldown$').test(cooldown)) throw new SafeError('Enhetsprofilens koppling är ogiltig.');
        await redis(['SET', cooldown, '1', 'EX', 8]);
      }
      await redis(['DEL', keys.session]);
      await redis(['EVAL', UNLOCK, 1, lockKey, owner]);
      return reply(res, 200, { ok: true, pending: false });
    } catch (error) {
      return reply(res, error instanceof SafeError ? error.status : 503, { error: error instanceof SafeError ? error.message : 'Webbläsartestet kunde inte avslutas just nu.' });
    }
  }
  async function forget(req, res) {
    if (req.method !== 'POST') return reply(res, 405, { error: 'Använd POST för att radera enhetsprofilen.' });
    if (!apiKey || !project || !redisUrl || !redisToken) return reply(res, 503, { error: 'Det privata webbläsartestet är inte anslutet.' });
    let device;
    try { device = deviceCookie(req); }
    catch (error) { return reply(res, error.status, { error: error.message }); }
    if (!device) return reply(res, 400, { error: 'Ingen sparad enhetsprofil finns i den här webbläsaren.' });
    const owner = crypto.randomBytes(32).toString('hex');
    let locked = false, outcome;
    try {
      // Serialize deletion with browser creation to avoid deleting an active profile.
      locked = await redis(['SET', lockKey, owner, 'NX', 'EX', 300]) === 'OK';
      if (!locked) return reply(res, 409, { error: 'Avsluta det aktiva webbläsartestet innan du raderar profilen.' });
      const key = profileKey(device), id = await redis(['GET', key]);
      if (id) {
        if (!validId(id)) throw new SafeError('Enhetsprofilens koppling är ogiltig.');
        await contexts('/' + encodeURIComponent(id), null, null, 'DELETE');
        await redis(['DEL', key, key + ':cooldown']);
      }
      setDeviceCookie(res, '', true);
      outcome = { status: 200, data: { ok: true, forgotten: true } };
    } catch (error) {
      outcome = { status: error instanceof SafeError ? error.status : 503, data: { error: error instanceof SafeError ? error.message : 'Enhetsprofilen kunde inte raderas just nu.' } };
    } finally {
      if (locked) { try { await redis(['EVAL', UNLOCK, 1, lockKey, owner]); } catch {} }
    }
    return reply(res, outcome.status, outcome.data);
  }
  return { handle, stop, forget };
}
module.exports = { createHostedSnap };
