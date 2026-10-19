'use strict';

const crypto = require('node:crypto');
const { createSwishClient } = require('./swish.cjs');

const SESSION_COOKIE = 'tros-session';
const PREFIX = 'tros:membership:v1:';
const PLANS_KEY = PREFIX + 'plans';
const USERS_KEY = PREFIX + 'users';
const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_DAYS = 3;
const SESSION_SECONDS = 365 * 24 * 60 * 60;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;
const DEFAULT_PLANS = [{ id: 'standard', name: 'Månadsmedlem', prices: [40, 35, 30], durationDays: 30 }];

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
function accessUntil(user) { return Math.max(Number(user?.paidUntilMs) || 0, Number(user?.trialUntilMs) || 0); }
function hasAccess(user, now = Date.now()) { return !!user && user.enabled !== false && accessUntil(user) > now; }
function planRecord(plan) {
  return plan && typeof plan.id === 'string' && typeof plan.name === 'string'
    ? { id: plan.id, name: plan.name, prices: Array.isArray(plan.prices) ? plan.prices : [40, 35, 30], durationDays: Number(plan.durationDays) || 30 }
    : null;
}
function publicUser(user, plans, now = Date.now()) {
  const plan = plans.find(item => item.id === user.planId) || plans[0] || DEFAULT_PLANS[0];
  const until = accessUntil(user);
  return {
    id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName,
    planId: plan.id, planName: plan.name, trialUntilMs: Number(user.trialUntilMs) || 0,
    paidUntilMs: Number(user.paidUntilMs) || 0, accessUntilMs: until,
    paidMonths: Number(user.paidMonths) || 0, active: hasAccess(user, now),
    daysLeft: Math.max(0, Math.ceil((until - now) / DAY_MS)),
    enabled: user.enabled !== false,
    devices: { computer: !!user.devices?.computer, mobile: !!user.devices?.mobile },
    createdAt: user.createdAt
  };
}
function publicPayment(payment, includeToken = false) {
  if (!payment) return null;
  const { callbackIdentifier, ...visible } = payment;
  if (!includeToken) delete visible.paymentToken;
  return visible;
}

function createMemberships(env = process.env, request = fetch) {
  const swish = createSwishClient(env, request);
  const endpointValue = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  let endpoint = null;
  try {
    if (endpointValue && token) {
      const parsed = new URL(endpointValue);
      if (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) endpoint = parsed;
    }
  } catch {}

  async function command(parts) {
    if (!endpoint || !token) fail(503, 'Medlemskap kräver att Redis är anslutet på servern.');
    let response;
    try {
      response = await request(endpoint, {
        method: 'POST', redirect: 'error',
        headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: JSON.stringify(parts), signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) throw new Error('Membership storage is unavailable');
      const data = await response.json();
      if (data.error) throw new Error('Membership storage is unavailable');
      return data.result;
    } catch (error) {
      if (error.status) throw error;
      fail(503, 'Medlemskapsdatabasen svarar inte. Försök igen senare.');
    }
  }
  const keyUser = id => PREFIX + 'user:' + id;
  const keyEmail = email => PREFIX + 'email:' + hash(email);
  const keySession = value => PREFIX + 'session:' + hash(value);
  const keyPayment = id => PREFIX + 'payment:' + id;
  const keyPending = id => PREFIX + 'pending:' + id;
  const keyLatestPayment = id => PREFIX + 'latest-payment:' + id;
  const keySwishRequest = id => PREFIX + 'swish-request:' + id;

  async function getUser(id) {
    const value = await command(['GET', keyUser(id)]);
    return safeJson(value);
  }
  async function getPlans() {
    let value = await command(['GET', PLANS_KEY]);
    if (!value) {
      await command(['SET', PLANS_KEY, JSON.stringify(DEFAULT_PLANS), 'NX']);
      value = await command(['GET', PLANS_KEY]);
    }
    const parsed = safeJson(value);
    if (!Array.isArray(parsed) || !parsed.length) fail(503, 'Abonnemangen kunde inte läsas från databasen.');
    return parsed.map(planRecord).filter(Boolean);
  }
  async function createUser(data) {
    const email = normalizeEmail(data.email);
    const firstName = typeof data.firstName === 'string' ? data.firstName.trim() : '';
    const lastName = typeof data.lastName === 'string' ? data.lastName.trim() : '';
    const password = typeof data.password === 'string' ? data.password : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) fail(400, 'Skriv en giltig e-postadress.');
    if (!firstName || firstName.length > 80 || !lastName || lastName.length > 80) fail(400, 'För- och efternamn krävs.');
    if (password.length < 10 || password.length > 128) fail(400, 'Lösenordet ska vara mellan 10 och 128 tecken.');
    const plans = await getPlans();
    const plan = plans.find(item => item.id === data.planId) || plans[0];
    const now = Date.now();
    const salt = crypto.randomBytes(16).toString('hex');
    const user = {
      id: crypto.randomUUID(), email, firstName, lastName,
      passwordSalt: salt, passwordHash: crypto.scryptSync(password, salt, 64).toString('hex'),
      planId: plan.id, createdAt: new Date(now).toISOString(), trialUntilMs: now + TRIAL_DAYS * DAY_MS,
      paidUntilMs: 0, paidMonths: 0, enabled: true, devices: { computer: null, mobile: null }
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
      // Expired members may still sign in to request the next Swish payment.
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
    const value = await command(['GET', keySession(tokenValue)]);
    const session = safeJson(value);
    if (!session || !['computer', 'mobile'].includes(session.deviceType)) return null;
    const user = await getUser(session.userId);
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
    if (!account) return { user: null, active: false, swishNumber: swish.payeeAlias || '', swishConfigured: swish.configured, plans: await getPlans() };
    const plans = await getPlans();
    const user = publicUser(account.user, plans);
    const plan = plans.find(item => item.id === user.planId) || plans[0];
    const amount = plan.prices[Math.min(user.paidMonths, 2)];
    const pendingId = await command(['GET', keyPending(account.user.id)]);
    const latestId = pendingId || await command(['GET', keyLatestPayment(account.user.id)]);
    const payment = latestId ? safeJson(await command(['GET', keyPayment(latestId)])) : null;
    return {
      user, active: user.active, nextPrice: amount, durationDays: plan.durationDays,
      swishNumber: swish.payeeAlias || '', swishConfigured: swish.configured, plans,
      pendingPayment: payment && ['initiating', 'pending'].includes(payment.status) ? publicPayment(payment, true) : null,
      latestPayment: payment?.status === 'paid' ? publicPayment(payment) : null
    };
  }
  async function createPayment(req) {
    const account = await getSession(req);
    if (!account) fail(401, 'Logga in för att beställa en betalning.');
    if (!swish.configured) fail(503, 'Automatisk Swish är inte ansluten. Admin behöver konfigurera Swish Commerce och servercertifikatet.');
    const user = account.user;
    const plans = await getPlans();
    const plan = plans.find(item => item.id === user.planId) || plans[0];
    const id = crypto.randomUUID();
    const instructionUUID = crypto.randomBytes(16).toString('hex').toUpperCase();
    const callbackIdentifier = crypto.randomUUID();
    const reference = 'TR' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const payment = {
      id, userId: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email,
      planId: plan.id, planName: plan.name, amount: plan.prices[Math.min(user.paidMonths, 2)],
      durationDays: plan.durationDays, cycle: (Number(user.paidMonths) || 0) + 1,
      reference, instructionUUID, callbackIdentifier, payeeAlias: swish.payeeAlias,
      status: 'initiating', createdAt: new Date().toISOString()
    };
    const script = `local existing=redis.call('GET',KEYS[3])
if existing then
 local current=redis.call('GET',ARGV[2]..existing)
 if current then
  local payment=cjson.decode(current)
  if payment.instructionUUID and (payment.status=='pending' or payment.status=='initiating') then return 'existing:'..existing end
 end
 redis.call('DEL',KEYS[3])
end
redis.call('SET',KEYS[1],ARGV[1])
redis.call('SADD',KEYS[2],ARGV[3])
redis.call('SET',KEYS[3],ARGV[3])
redis.call('SET',KEYS[4],ARGV[3])
redis.call('SET',KEYS[5],ARGV[3])
return 'new:'..ARGV[3]`;
    const result = await command(['EVAL', script, 5, keyPayment(id), PREFIX + 'payments', keyPending(user.id), keyLatestPayment(user.id), keySwishRequest(instructionUUID), JSON.stringify(payment), PREFIX + 'payment:', id]);
    const resultText = String(result || '');
    if (resultText.startsWith('existing:')) {
      const existing = safeJson(await command(['GET', keyPayment(resultText.slice('existing:'.length))]));
      if (existing?.status === 'pending' && existing.paymentToken) return publicPayment(existing, true);
      fail(409, 'Swish-betalningen håller på att starta. Ladda om sidan om en liten stund.');
    }
    if (!resultText.startsWith('new:')) fail(503, 'Betalningsordern kunde inte sparas.');
    let swishPayment;
    try {
      swishPayment = await swish.createPayment({
        instructionUUID, reference, amount: payment.amount, callbackIdentifier,
        message: 'TR-os ' + plan.name
      });
    } catch (error) {
      await command(['SET', keyPayment(id), JSON.stringify({ ...payment, status: 'failed', errorMessage: error.message, failedAt: new Date().toISOString() })]);
      await command(['DEL', keyPending(user.id)]);
      throw error;
    }
    const completeScript = `local raw=redis.call('GET',KEYS[1])
if not raw then return 'missing' end
local payment=cjson.decode(raw)
if payment.status=='initiating' then
 payment.status='pending'
 payment.paymentToken=ARGV[1]
 redis.call('SET',KEYS[1],cjson.encode(payment))
end
return cjson.encode(payment)`;
    const completed = safeJson(await command(['EVAL', completeScript, 1, keyPayment(id), swishPayment.token]));
    if (!completed) fail(503, 'Swish-betalningen sparades inte. Försök igen.');
    return publicPayment(completed, true);
  }
  async function paymentQr(req, id) {
    const account = await getSession(req);
    if (!account) fail(401, 'Logga in för att visa Swish QR-koden.');
    const payment = safeJson(await command(['GET', keyPayment(id)]));
    if (!payment || payment.userId !== account.user.id || payment.status !== 'pending' || !payment.paymentToken) fail(404, 'Swish-betalningen hittades inte.');
    return swish.qr(payment.paymentToken);
  }
  function sameSecret(left, right) {
    if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
    return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
  }
  async function processSwishCallback(callbackIdentifier, event) {
    const instructionUUID = typeof event?.id === 'string' ? event.id.toUpperCase() : '';
    if (!/^[A-F0-9]{32}$/.test(instructionUUID)) fail(400, 'Ogiltigt Swish-betalnings-ID.');
    const paymentId = await command(['GET', keySwishRequest(instructionUUID)]);
    const payment = paymentId ? safeJson(await command(['GET', keyPayment(paymentId)])) : null;
    if (!payment) fail(404, 'Swish-betalningen hittades inte.');
    if (!sameSecret(callbackIdentifier, payment.callbackIdentifier)) fail(401, 'Swish-bekräftelsen kunde inte verifieras.');
    if (event.payeeAlias !== payment.payeeAlias || event.payeePaymentReference !== payment.reference || event.currency !== 'SEK' || Math.round(Number(event.amount) * 100) !== Math.round(Number(payment.amount) * 100)) {
      fail(400, 'Swish-bekräftelsen stämmer inte med betalningsordern.');
    }
    const result = await applySwishResult(payment, event);
    return result;
  }
  async function applySwishResult(payment, event) {
    const now = Date.now();
    const status = String(event.status || '').toUpperCase();
    if (!['PAID', 'DECLINED', 'ERROR', 'CANCELLED'].includes(status)) fail(400, 'Okänd Swish-status.');
    const script = `local rawp=redis.call('GET',KEYS[1])
if not rawp then return 'missing' end
local payment=cjson.decode(rawp)
if payment.instructionUUID~=ARGV[1] or payment.callbackIdentifier~=ARGV[2] or payment.reference~=ARGV[3] or payment.payeeAlias~=ARGV[4] then return 'mismatch' end
if payment.status=='paid' then
 if ARGV[5]=='PAID' and payment.paymentReference==ARGV[7] then return cjson.encode({payment=payment,newlyPaid=false}) end
 return 'closed'
end
if payment.status~='pending' and payment.status~='initiating' then return 'closed' end
if ARGV[5]=='PAID' then
 local rawu=redis.call('GET',KEYS[2])
 if not rawu then return 'missinguser' end
 local user=cjson.decode(rawu)
 local now=tonumber(ARGV[6])
 local base=math.max(now,tonumber(user.paidUntilMs) or 0,tonumber(user.trialUntilMs) or 0)
 local days=tonumber(payment.durationDays) or 30
 user.paidUntilMs=base+days*86400000
 user.paidMonths=(tonumber(user.paidMonths) or 0)+1
 payment.status='paid'
 payment.paymentReference=ARGV[7]
 payment.confirmedAt=ARGV[8]
 redis.call('SET',KEYS[2],cjson.encode(user))
 redis.call('SET',KEYS[1],cjson.encode(payment))
 if redis.call('GET',KEYS[3])==payment.id then redis.call('DEL',KEYS[3]) end
 return cjson.encode({payment=payment,user=user,newlyPaid=true})
end
payment.status=string.lower(ARGV[5])
payment.errorCode=ARGV[9]
payment.failedAt=ARGV[8]
redis.call('SET',KEYS[1],cjson.encode(payment))
if redis.call('GET',KEYS[3])==payment.id then redis.call('DEL',KEYS[3]) end
return cjson.encode({payment=payment,newlyPaid=false})`;
    const raw = await command(['EVAL', script, 3, keyPayment(payment.id), keyUser(payment.userId), keyPending(payment.userId), payment.instructionUUID, payment.callbackIdentifier, payment.reference, payment.payeeAlias, status, now, String(event.paymentReference || ''), new Date(now).toISOString(), String(event.errorCode || '')]);
    if (typeof raw !== 'string' || !raw.startsWith('{')) {
      const messages = { missing: 'Betalningsordern hittades inte.', mismatch: 'Swish-bekräftelsen stämmer inte.', closed: 'Betalningsordern är redan avslutad.', missinguser: 'Medlemskontot hittades inte.' };
      fail(raw === 'missing' ? 404 : 409, messages[raw] || 'Swish-betalningen kunde inte uppdateras.');
    }
    return safeJson(raw);
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
    const plans = await getPlans();
    return values.map(safeJson).filter(Boolean).map(user => publicUser(user, plans));
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
    if (changes.planId !== undefined) {
      const plan = (await getPlans()).find(item => item.id === changes.planId); if (!plan) fail(400, 'Välj ett abonnemang som finns.'); user.planId = plan.id;
    }
    if (changes.paidUntilMs !== undefined) {
      const value = Number(changes.paidUntilMs); if (!Number.isFinite(value) || value < 0 || value > 4102444800000) fail(400, 'Ogiltigt slutdatum.'); user.paidUntilMs = value;
    }
    if (changes.paidMonths !== undefined) {
      const value = Number(changes.paidMonths); if (!Number.isInteger(value) || value < 0 || value > 10000) fail(400, 'Ogiltigt antal betalda månader.'); user.paidMonths = value;
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
    return publicUser(user, await getPlans());
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
  async function updatePlans(value) {
    if (!Array.isArray(value) || !value.length || value.length > 20) fail(400, 'Det måste finnas mellan 1 och 20 abonnemang.');
    const ids = new Set();
    const plans = value.map(item => {
      const id = typeof item?.id === 'string' ? item.id.trim().toLowerCase() : '';
      const name = typeof item?.name === 'string' ? item.name.trim() : '';
      const prices = Array.isArray(item?.prices) ? item.prices.map(Number) : [];
      const durationDays = Number(item?.durationDays);
      if (!/^[a-z0-9_-]{2,40}$/.test(id) || ids.has(id)) fail(400, 'Abonnemangen måste ha unika ID:n med bokstäver eller siffror.');
      if (!name || name.length > 80 || prices.length !== 3 || prices.some(price => !Number.isInteger(price) || price < 0 || price > 100000)) fail(400, 'Ange namn och tre giltiga månadspriser för varje abonnemang.');
      if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 365) fail(400, 'Månadsperioden ska vara mellan 1 och 365 dagar.');
      ids.add(id); return { id, name, prices, durationDays };
    });
    await command(['SET', PLANS_KEY, JSON.stringify(plans)]);
    return plans;
  }
  async function adminCreateUser(data) { return createUser(data); }

  return Object.freeze({
    configured: !!endpoint,
    swishConfigured: swish.configured,
    swishNumber: swish.payeeAlias,
    authenticate: getSession,
    register,
    login,
    logout,
    summary,
    createPayment,
    paymentQr,
    processSwishCallback,
    listPayments,
    listUsers,
    updateUser,
    resetDevices,
    updatePlans,
    getPlans,
    adminCreateUser,
    hasAccess,
    accessUntil,
    sessionToken,
    sessionCookie,
    clearSessionCookie,
    publicUser
  });
}

module.exports = { createMemberships, SESSION_COOKIE, TRIAL_DAYS, DEFAULT_PLANS };
