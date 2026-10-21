'use strict';

const crypto = require('node:crypto');
const { createSwish } = require('./swish.cjs');
const { createRedisCircuit, classifyFailure } = require('./redis-circuit.cjs');

const SESSION_COOKIE = 'tros-session';
const PREFIX = 'tros:membership:v1:';
const USERS_KEY = PREFIX + 'users';
const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_SECONDS = 365 * 24 * 60 * 60;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;

function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function safeJson(value) { try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return null; } }
function normalizeEmail(value) { return typeof value === 'string' ? value.trim().toLowerCase() : ''; }
function sessionToken(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index >= 0 && part.slice(0, index).trim() === SESSION_COOKIE) {
      const value = part.slice(index + 1).trim();
      return /^[A-Za-z0-9_-]{40,64}$/.test(value) ? value : '';
    }
  }
  return '';
}
function sessionCookie(token, req, env) {
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const secure = forwarded === 'https' || env.VERCEL === '1' || env.RENDER === 'true' || env.NODE_ENV === 'production';
  return SESSION_COOKIE + '=' + token + '; Path=/; Max-Age=' + SESSION_SECONDS + '; HttpOnly; SameSite=Lax' + (secure ? '; Secure' : '');
}
function clearSessionCookie(req, env) {
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const secure = forwarded === 'https' || env.VERCEL === '1' || env.RENDER === 'true' || env.NODE_ENV === 'production';
  return SESSION_COOKIE + '=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax' + (secure ? '; Secure' : '');
}
function requestedDeviceId(value) {
  if (typeof value !== 'string' || !DEVICE_ID_PATTERN.test(value)) fail(400, 'Enhets-ID saknas. Ladda om sidan och försök igen.');
  return value;
}
function deviceType(req) {
  return /android|iphone|ipad|ipod|mobile/i.test(String(req.headers['user-agent'] || '')) ? 'mobile' : 'computer';
}
function accessUntil(user) { return Number(user?.paidUntilMs) || 0; }
function hasAccess(user, now = Date.now()) { return !!user && user.enabled !== false && accessUntil(user) > now; }
function grantDuration(daysValue, hoursValue) {
  const days = Number(daysValue);
  const hours = Number(hoursValue);
  if (!Number.isInteger(days) || days < 0 || days > 3650 || !Number.isInteger(hours) || hours < 0 || hours > 23 || days * 24 + hours < 1) {
    fail(400, 'Ange minst en dag eller timme. Dagar får vara 0–3650 och timmar 0–23.');
  }
  return { days, hours, durationMs: (days * 24 + hours) * 60 * 60 * 1000 };
}
function publicUser(user, now = Date.now()) {
  const until = accessUntil(user);
  return {
    id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName,
    paidUntilMs: Number(user.paidUntilMs) || 0, accessUntilMs: until,
    active: hasAccess(user, now),
    daysLeft: Math.max(0, Math.ceil((until - now) / DAY_MS)),
    enabled: user.enabled !== false,
    devices: { computer: !!user.devices?.computer, mobile: !!user.devices?.mobile },
    createdAt: user.createdAt
  };
}
function publicPayment(payment) {
  if (!payment) return null;
  const { callbackIdentifier, paymentToken, instructionUUID, payeeAlias, ...visible } = payment;
  return visible;
}

function createMemberships(env = process.env, request = fetch, redisCircuit = createRedisCircuit()) {
  const swish = createSwish(env);
  const endpointValue = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  let endpoint = null;
  try {
    if (endpointValue && token) {
      const parsed = new URL(endpointValue);
      if (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) endpoint = parsed;
    }
  } catch {}

  function failStorage(reason, upstreamStatus) {
    const safeReason = upstreamStatus ? `${reason}_http_${upstreamStatus}` : reason;
    if (reason !== 'circuit_open' && reason !== 'not_configured') {
      console.warn('[membership-storage] Redis REST failure', {
        host: endpoint?.host || null,
        reason,
        ...(upstreamStatus ? { status: upstreamStatus } : {})
      });
      redisCircuit.recordFailure(safeReason);
    }
    throw Object.assign(new Error('Medlemskapsdatabasen svarar inte. Försök igen senare.'), { status: 503, storageReason: safeReason });
  }

  async function command(parts) {
    if (!endpoint || !token) failStorage('not_configured');
    if (redisCircuit.isOpen()) failStorage('circuit_open');
    // Only repeat read-only commands: a lost response to a write could otherwise
    // apply the same membership change twice.
    const retryable = parts[0] === 'GET' || parts[0] === 'PING';
    const attempts = retryable ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      let response;
      try {
        response = await request(endpoint, {
          method: 'POST', redirect: 'error',
          headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
          body: JSON.stringify(parts), signal: AbortSignal.timeout(attempt ? 2000 : 5000)
        });
      } catch (error) {
        if (attempt + 1 < attempts) {
          await new Promise(resolve => setTimeout(resolve, 150));
          continue;
        }
        const code = String(error?.cause?.code || error?.code || error?.name || '').toUpperCase();
        const reasons = {
          ECONNRESET: 'network_reset', ETIMEDOUT: 'network_timeout', TIMEOUTERROR: 'network_timeout',
          ABORT_ERR: 'network_timeout', ENOTFOUND: 'network_dns', EAI_AGAIN: 'network_dns_temporary',
          ECONNREFUSED: 'network_refused'
        };
        failStorage(reasons[code] || 'network_error');
      }

      if (!response.ok) {
        const status = response.status;
        if (retryable && attempt === 0 && (status === 408 || status === 425 || status === 429 || status >= 500)) {
          await response.body?.cancel().catch(() => {});
          await new Promise(resolve => setTimeout(resolve, 150));
          continue;
        }
        let message = '';
        try { message = (await response.text()).slice(0, 2048); } catch {}
        failStorage(classifyFailure(message), status);
      }

      let data;
      try { data = await response.json(); }
      catch {
        failStorage('invalid_response');
      }
      if (data.error) {
        const reason = classifyFailure(data.error);
        failStorage(reason === 'upstream_error' ? 'redis_command_error' : reason);
      }
      redisCircuit.recordSuccess();
      return data.result;
    }
    failStorage('upstream_unavailable');
  }
  // Read-only dependency probe. Coalesce public health checks so monitoring
  // cannot multiply Redis traffic or read any customer records.
  let healthResult = 'unconfigured', healthReason = 'not_configured', healthUntil = 0, healthPending;
  function health() {
    if (!endpoint) { healthReason = 'not_configured'; return Promise.resolve('unconfigured'); }
    if (redisCircuit.isOpen()) {
      healthResult = 'unavailable';
      healthReason = redisCircuit.diagnostics().lastFailure || 'upstream_unavailable';
      return Promise.resolve(healthResult);
    }
    if (healthPending) return healthPending;
    if (Date.now() < healthUntil) return Promise.resolve(healthResult);
    healthPending = (async () => {
      try {
        const pong = await command(['PING']);
        if (pong !== 'PONG') throw Object.assign(new Error('Unexpected Redis health response'), { storageReason: 'unexpected_ping_response' });
        // Membership lookups use GET. Probe it too: PING can succeed even when
        // the configured Redis credential cannot read membership keys.
        await command(['GET', PREFIX + 'health:probe']);
        healthResult = 'ready';
        healthReason = 'ok';
      } catch (error) {
        healthResult = 'unavailable';
        healthReason = error.storageReason || 'upstream_unavailable';
      }
      healthUntil = Date.now() + 60000;
      return healthResult;
    })().finally(() => { healthPending = null; });
    return healthPending;
  }
  async function healthDetails() {
    const status = await health();
    return { status, reason: healthReason };
  }
  const keyUser = id => PREFIX + 'user:' + id;
  const keyEmail = email => PREFIX + 'email:' + hash(email);
  const keySession = value => PREFIX + 'session:' + hash(value);
  const keyPayment = id => PREFIX + 'payment:' + id;
  const keyPending = id => PREFIX + 'pending:' + id;
  const keyLatestPayment = id => PREFIX + 'latest-payment:' + id;

  async function getUser(id) {
    const value = await command(['GET', keyUser(id)]);
    return safeJson(value);
  }
  async function createUser(data, accessDays = 0) {
    const email = normalizeEmail(data.email);
    const firstName = typeof data.firstName === 'string' ? data.firstName.trim() : '';
    const lastName = typeof data.lastName === 'string' ? data.lastName.trim() : '';
    const password = typeof data.password === 'string' ? data.password : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) fail(400, 'Skriv en giltig e-postadress.');
    if (!firstName || firstName.length > 80 || !lastName || lastName.length > 80) fail(400, 'För- och efternamn krävs.');
    if (password.length < 10 || password.length > 128) fail(400, 'Lösenordet ska vara mellan 10 och 128 tecken.');
    if (!Number.isInteger(accessDays) || accessDays < 0 || accessDays > 3650) fail(400, 'Åtkomsttiden ska vara mellan 0 och 3650 dagar.');
    const now = Date.now();
    const salt = crypto.randomBytes(16).toString('hex');
    const user = {
      id: crypto.randomUUID(), email, firstName, lastName,
      passwordSalt: salt, passwordHash: crypto.scryptSync(password, salt, 64).toString('hex'),
      createdAt: new Date(now).toISOString(),
      paidUntilMs: accessDays ? now + accessDays * DAY_MS : 0, enabled: true, devices: { computer: null, mobile: null }
    };
    const script = `if redis.call('EXISTS',KEYS[1])==1 then return 0 end
redis.call('SET',KEYS[1],ARGV[1])
redis.call('SET',KEYS[2],ARGV[2])
redis.call('SADD',KEYS[3],ARGV[3])
return 1`;
    const created = await command(['EVAL', script, 3, keyEmail(email), keyUser(user.id), USERS_KEY, user.id, JSON.stringify(user), user.id]);
    if (Number(created) !== 1) fail(409, 'E-postadressen används redan.');
    return user;
  }
  async function authenticatePassword(emailValue, password) {
    const email = normalizeEmail(emailValue);
    const id = await command(['GET', keyEmail(email)]);
    const user = id ? await getUser(id) : null;
    if (!user || typeof password !== 'string' || !/^[a-f0-9]{128}$/i.test(user.passwordHash || '')) fail(401, 'Fel e-postadress eller lösenord.');
    const supplied = crypto.scryptSync(password, user.passwordSalt, 64);
    if (!crypto.timingSafeEqual(supplied, Buffer.from(user.passwordHash, 'hex'))) fail(401, 'Fel e-postadress eller lösenord.');
    if (!hasAccess(user)) {
      // Customers without assigned time may still sign in to view their account status.
      if (user.enabled === false) fail(403, 'Kontot är pausat. Be administratören om hjälp.');
    }
    return user;
  }
  async function issueSession(user, req, deviceId) {
    const type = deviceType(req);
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hash(rawToken);
    const sessionKey = keySession(rawToken);
    const sessionData = { userId: user.id, deviceId, deviceType: type, createdAt: new Date().toISOString() };
    const script = `local raw=redis.call('GET',KEYS[1])
if not raw then return 'missing' end
local user=cjson.decode(raw)
if user.enabled==false then return 'disabled' end
user.devices=user.devices or {}
local old=user.devices[ARGV[1]]
if old and old~=cjson.null and old.deviceId~=ARGV[2] then return 'occupied' end
if old and old~=cjson.null and old.sessionHash then redis.call('DEL',ARGV[4]..old.sessionHash) end
user.devices[ARGV[1]]={deviceId=ARGV[2],sessionHash=ARGV[3],createdAt=ARGV[5]}
redis.call('SET',KEYS[1],cjson.encode(user))
redis.call('SET',KEYS[2],ARGV[6],'EX',ARGV[7])
return 'ok'`;
    const result = await command(['EVAL', script, 2, keyUser(user.id), sessionKey, type, deviceId, tokenHash, PREFIX + 'session:', sessionData.createdAt, JSON.stringify(sessionData), SESSION_SECONDS]);
    if (result === 'occupied') fail(409, 'Det finns redan en inloggad ' + (type === 'mobile' ? 'mobil' : 'dator').toLowerCase() + '. Be admin återställa enheterna om du har bytt enhet.');
    if (result !== 'ok') fail(403, 'Kontot kan inte logga in.');
    return { token: rawToken, deviceType: type };
  }
  async function register(data, req) {
    const deviceId = requestedDeviceId(data.deviceId);
    const user = await createUser(data);
    const session = await issueSession(user, req, deviceId);
    return { token: session.token, user, deviceType: session.deviceType };
  }
  async function login(data, req) {
    const deviceId = requestedDeviceId(data.deviceId);
    const user = await authenticatePassword(data.email, data.password);
    const session = await issueSession(user, req, deviceId);
    return { token: session.token, user, deviceType: session.deviceType };
  }
  async function getSession(req) {
    const tokenValue = sessionToken(req);
    if (!tokenValue) return null;
    const values = await command(['EVAL', `local raw=redis.call('GET',KEYS[1])
if not raw then return nil end
local ok,session=pcall(cjson.decode,raw)
if not ok or type(session)~='table' or type(session.userId)~='string' then return nil end
local user=redis.call('GET',ARGV[1]..session.userId)
if not user then return nil end
return {raw,user}`, 1, keySession(tokenValue), PREFIX + 'user:']);
    if (!Array.isArray(values) || values.length !== 2) return null;
    const session = safeJson(values[0]);
    if (!session || !['computer', 'mobile'].includes(session.deviceType)) return null;
    const user = safeJson(values[1]);
    if (!user || user.enabled === false) return null;
    const slot = user.devices?.[session.deviceType];
    if (!slot || slot.sessionHash !== hash(tokenValue) || slot.deviceId !== session.deviceId) return null;
    return { token: tokenValue, session, user };
  }
  async function logout(req) {
    const account = await getSession(req);
    if (!account) return;
    const tokenHash = hash(account.token);
    const script = `local raw=redis.call('GET',KEYS[1])
if raw then
 local user=cjson.decode(raw)
 local slot=user.devices and user.devices[ARGV[1]]
 if slot and slot~=cjson.null and slot.sessionHash==ARGV[2] then user.devices[ARGV[1]]=cjson.null; redis.call('SET',KEYS[1],cjson.encode(user)) end
end
redis.call('DEL',KEYS[2])
return 1`;
    await command(['EVAL', script, 2, keyUser(account.user.id), keySession(account.token), account.session.deviceType, tokenHash]);
  }
  async function summary(req) {
    const account = await getSession(req);
    if (!account) return { user: null, active: false };
    const user = publicUser(account.user);
    const pendingId = await command(['GET', keyPending(account.user.id)]);
    const pendingPayment = pendingId ? safeJson(await command(['GET', keyPayment(pendingId)])) : null;
    return {
      user, active: user.active, swishNumber: swish.number,
      pendingPayment: pendingPayment?.status === 'pending' ? publicPayment(pendingPayment) : null
    };
  }
  async function createManualPayment(req) {
    const account = await getSession(req);
    if (!account) fail(401, 'Logga in för att begära mer åtkomsttid.');
    if (account.user.enabled === false) fail(403, 'Kontot är pausat.');
    const id = crypto.randomUUID();
    const payment = {
      id, userId: account.user.id, firstName: account.user.firstName, lastName: account.user.lastName,
      email: account.user.email, amount: swish.amount, durationDays: swish.durationDays,
      reference: swish.createReference(),
      status: 'pending', paidRequested: false, createdAt: new Date().toISOString()
    };
    const script = `local existing=redis.call('GET',KEYS[3])
if existing then
 local current=redis.call('GET',ARGV[2]..existing)
 if current then
  local old=cjson.decode(current)
  if old.status=='pending' then return 'existing:'..existing end
 end
 redis.call('DEL',KEYS[3])
end
redis.call('SET',KEYS[1],ARGV[1])
redis.call('SADD',KEYS[2],ARGV[3])
redis.call('SET',KEYS[3],ARGV[3])
redis.call('SET',KEYS[4],ARGV[3])
return 'new:'..ARGV[3]`;
    const result = String(await command([
      'EVAL', script, 4, keyPayment(id), PREFIX + 'payments', keyPending(account.user.id), keyLatestPayment(account.user.id),
      JSON.stringify(payment), PREFIX + 'payment:', id
    ]) || '');
    if (result.startsWith('existing:')) {
      const existing = safeJson(await command(['GET', keyPayment(result.slice('existing:'.length))]));
      if (existing?.status === 'pending') return publicPayment(existing);
    }
    if (result !== 'new:' + id) fail(503, 'Swishförfrågan kunde inte sparas. Försök igen.');
    return publicPayment(payment);
  }
  async function markPaid(req, id, data) {
    const account = await getSession(req);
    if (!account) fail(401, 'Logga in för att anmäla Swishbetalningen.');
    const firstName = typeof data.firstName === 'string' ? data.firstName.trim() : '';
    const lastName = typeof data.lastName === 'string' ? data.lastName.trim() : '';
    const reference = typeof data.reference === 'string' ? data.reference.trim().toUpperCase() : '';
    if (!firstName || firstName.length > 80 || !lastName || lastName.length > 80) fail(400, 'Skriv för- och efternamnet på den som betalade.');
    if (!/^[A-Z0-9]{4,20}$/.test(reference)) fail(400, 'Betalningsreferensen är ogiltig.');
    const payment = safeJson(await command(['GET', keyPayment(id)]));
    if (!payment || payment.userId !== account.user.id) fail(404, 'Swishförfrågan hittades inte.');
    const script = `local raw=redis.call('GET',KEYS[1])
if not raw then return 'missing' end
local payment=cjson.decode(raw)
if payment.userId~=ARGV[1] or payment.reference~=ARGV[2] then return 'mismatch' end
if payment.status~='pending' then return 'closed' end
if payment.paidRequested==true then return cjson.encode({payment=payment,notified=false}) end
payment.paidRequested=true
payment.reportedFirstName=ARGV[3]
payment.reportedLastName=ARGV[4]
payment.customerReportedPaidAt=ARGV[5]
redis.call('SET',KEYS[1],cjson.encode(payment))
return cjson.encode({payment=payment,notified=true})`;
    const raw = await command(['EVAL', script, 1, keyPayment(id), account.user.id, reference, firstName, lastName, new Date().toISOString()]);
    const result = typeof raw === 'string' && raw.startsWith('{') ? safeJson(raw) : null;
    if (!result) {
      const messages = { missing: 'Swishförfrågan hittades inte.', mismatch: 'Referensen stämmer inte med förfrågan.', closed: 'Förfrågan är redan avslutad.' };
      fail(raw === 'missing' ? 404 : 409, messages[raw] || 'Swishbetalningen kunde inte anmälas.');
    }
    return result;
  }
  async function confirmPayment(id) {
    const storedPayment = safeJson(await command(['GET', keyPayment(id)]));
    if (!storedPayment) fail(404, 'Betalningen hittades inte.');
    const now = Date.now();
    const script = `local rawp=redis.call('GET',KEYS[1])
if not rawp then return 'missing' end
local payment=cjson.decode(rawp)
if payment.status~='pending' then return 'closed' end
if payment.paidRequested~=true then return 'notreported' end
local rawu=redis.call('GET',KEYS[2])
if not rawu then return 'missinguser' end
local user=cjson.decode(rawu)
if user.enabled==false then return 'disabled' end
local now=tonumber(ARGV[1])
local base=math.max(now,tonumber(user.paidUntilMs) or 0)
local days=tonumber(payment.durationDays) or 30
user.paidUntilMs=base+days*86400000
payment.status='paid'
payment.confirmedAt=ARGV[2]
payment.confirmedManually=true
redis.call('SET',KEYS[1],cjson.encode(payment))
redis.call('SET',KEYS[2],cjson.encode(user))
if redis.call('GET',KEYS[3])==payment.id then redis.call('DEL',KEYS[3]) end
return cjson.encode({payment=payment,user=user})`;
    const raw = await command(['EVAL', script, 3, keyPayment(id), keyUser(storedPayment.userId), keyPending(storedPayment.userId), now, new Date(now).toISOString()]);
    const result = typeof raw === 'string' && raw.startsWith('{') ? safeJson(raw) : null;
    if (!result) {
      const messages = { missing: 'Betalningen hittades inte.', closed: 'Betalningen är redan avslutad.', notreported: 'Medlemmen har inte anmält betalningen ännu.', missinguser: 'Medlemskontot hittades inte.', disabled: 'Kontot är pausat. Återaktivera det innan betalningen godkänns.' };
      fail(raw === 'missing' ? 404 : 409, messages[raw] || 'Betalningen kunde inte godkännas.');
    }
    return result;
  }

  async function addTime(id, daysValue, hoursValue) {
    const { days, hours, durationMs } = grantDuration(daysValue, hoursValue);
    const now = Date.now();
    const script = `local raw=redis.call('GET',KEYS[1])
if not raw then return 'missing' end
local user=cjson.decode(raw)
local base=math.max(tonumber(ARGV[1]),tonumber(user.paidUntilMs) or 0)
user.paidUntilMs=base+tonumber(ARGV[2])
redis.call('SET',KEYS[1],cjson.encode(user))
return cjson.encode(user)`;
    const raw = await command(['EVAL', script, 1, keyUser(id), now, durationMs]);
    const user = typeof raw === 'string' ? safeJson(raw) : null;
    if (!user) fail(raw === 'missing' ? 404 : 503, raw === 'missing' ? 'Medlemmen hittades inte.' : 'Tiden kunde inte läggas till.');
    return { user: publicUser(user), days, hours };
  }

  async function addTimeToExpiredUsers(daysValue, hoursValue) {
    const { durationMs } = grantDuration(daysValue, hoursValue);
    const now = Date.now();
    const script = `local ids=redis.call('SMEMBERS',KEYS[1])
local updated=0
for _,id in ipairs(ids) do
 local key=ARGV[1]..id
 local raw=redis.call('GET',key)
 if raw then
  local user=cjson.decode(raw)
  local paid=tonumber(user.paidUntilMs) or 0
  if user.enabled~=false and paid<=tonumber(ARGV[2]) then
   user.paidUntilMs=tonumber(ARGV[2])+tonumber(ARGV[3])
   redis.call('SET',key,cjson.encode(user))
   updated=updated+1
  end
 end
end
return updated`;
    const updated = await command(['EVAL', script, 1, USERS_KEY, PREFIX + 'user:', now, durationMs]);
    return Number(updated) || 0;
  }

  async function listPayments() {
    const script = `local ids=redis.call('SMEMBERS',KEYS[1])
local out={}
for _,id in ipairs(ids) do local v=redis.call('GET',ARGV[1]..id); if v then table.insert(out,v) end end
return out`;
    const values = await command(['EVAL', script, 1, PREFIX + 'payments', PREFIX + 'payment:']);
    if (!Array.isArray(values)) fail(503, 'Betalningslistan kunde inte läsas.');
    return values.map(safeJson).filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(payment => publicPayment(payment));
  }
  async function listUsers() {
    const script = `local ids=redis.call('SMEMBERS',KEYS[1])
local out={}
for _,id in ipairs(ids) do local v=redis.call('GET',ARGV[1]..id); if v then table.insert(out,v) end end
return out`;
    const values = await command(['EVAL', script, 1, USERS_KEY, PREFIX + 'user:']);
    if (!Array.isArray(values)) fail(503, 'Medlemslistan kunde inte läsas.');
    return values.map(safeJson).filter(Boolean).map(user => publicUser(user));
  }
  async function deleteUser(id) {
    const user = await getUser(id);
    if (!user) fail(404, 'Kundkontot hittades inte.');
    const script = `local raw=redis.call('GET',KEYS[1])
if not raw then return 0 end
local user=cjson.decode(raw)
for _,kind in ipairs({'computer','mobile'}) do
 local slot=user.devices and user.devices[kind]
 if slot and slot~=cjson.null and slot.sessionHash then redis.call('DEL',ARGV[1]..slot.sessionHash) end
end
local paymentIds=redis.call('SMEMBERS',KEYS[4])
for _,paymentId in ipairs(paymentIds) do
 local paymentKey=ARGV[2]..paymentId
 local paymentRaw=redis.call('GET',paymentKey)
 if paymentRaw then
  local payment=cjson.decode(paymentRaw)
  if payment.userId==ARGV[3] then redis.call('DEL',paymentKey); redis.call('SREM',KEYS[4],paymentId) end
 end
end
redis.call('DEL',KEYS[1],KEYS[3],KEYS[5],KEYS[6])
redis.call('SREM',KEYS[2],ARGV[3])
return 1`;
    const removed = await command(['EVAL', script, 6,
      keyUser(id), USERS_KEY, keyEmail(user.email), PREFIX + 'payments', keyPending(id), keyLatestPayment(id),
      PREFIX + 'session:', PREFIX + 'payment:', id]);
    if (Number(removed) !== 1) fail(404, 'Kundkontot hittades inte.');
    return true;
  }
  async function updateUser(id, changes) {
    const user = await getUser(id);
    if (!user) fail(404, 'Medlemmen hittades inte.');
    if (typeof changes.firstName === 'string') {
      const value = changes.firstName.trim(); if (!value || value.length > 80) fail(400, 'Ogiltigt förnamn.'); user.firstName = value;
    }
    if (typeof changes.lastName === 'string') {
      const value = changes.lastName.trim(); if (!value || value.length > 80) fail(400, 'Ogiltigt efternamn.'); user.lastName = value;
    }
    if (changes.paidUntilMs !== undefined) {
      const value = Number(changes.paidUntilMs); if (!Number.isFinite(value) || value < 0 || value > 4102444800000) fail(400, 'Ogiltigt slutdatum.'); user.paidUntilMs = value;
    }
    if (changes.enabled !== undefined) user.enabled = changes.enabled === true;
    let resetSessions = false;
    if (typeof changes.password === 'string' && changes.password.length) {
      if (changes.password.length < 10 || changes.password.length > 128) fail(400, 'Det nya lösenordet ska vara mellan 10 och 128 tecken.');
      user.passwordSalt = crypto.randomBytes(16).toString('hex');
      user.passwordHash = crypto.scryptSync(changes.password, user.passwordSalt, 64).toString('hex');
      resetSessions = true;
    }
    await command(['SET', keyUser(id), JSON.stringify(user)]);
    if (resetSessions) await resetDevices(id);
    return publicUser(user);
  }
  async function resetDevices(id) {
    // Delete sessions before clearing their hashes from the user's device slots.
    const user = await getUser(id);
    if (!user) fail(404, 'Medlemmen hittades inte.');
    const keys = ['computer', 'mobile'].map(kind => user.devices?.[kind]?.sessionHash).filter(Boolean).map(value => PREFIX + 'session:' + value);
    if (keys.length) await command(['DEL', ...keys]);
    const cleanScript = `local raw=redis.call('GET',KEYS[1])
if not raw then return 0 end
local user=cjson.decode(raw)
user.devices={computer=cjson.null,mobile=cjson.null}
redis.call('SET',KEYS[1],cjson.encode(user))
return 1`;
    await command(['EVAL', cleanScript, 1, keyUser(id)]);
    return true;
  }
  async function adminCreateUser(data) {
    const days = Number(data.accessDays);
    if (!Number.isInteger(days) || days < 0 || days > 3650) fail(400, 'Ange åtkomst mellan 0 och 3650 dagar.');
    return createUser(data, days);
  }

  return Object.freeze({
    configured: !!endpoint,
    health,
    healthDetails,
    swishNumber: swish.number,
    authenticate: getSession,
    register,
    login,
    logout,
    summary,
    createPayment: createManualPayment,
    markPaid,
    confirmPayment,
    addTime,
    addTimeToExpiredUsers,
    listPayments,
    listUsers,
    deleteUser,
    updateUser,
    resetDevices,
    adminCreateUser,
    hasAccess,
    accessUntil,
    sessionToken,
    sessionCookie,
    clearSessionCookie,
    publicUser
  });
}

module.exports = { createMemberships, SESSION_COOKIE };
