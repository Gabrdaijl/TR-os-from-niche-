#!/usr/bin/env node
'use strict';

// Logical, binary-safe migration. Never point the application at the destination
// until import and verification have completed. This is not an atomic snapshot.
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');

const FORMAT = 'tros-redis-logical';
const VERSION = 1;
const DEFAULT_LIMITS = Object.freeze({ maxKeys: 100000, maxBytes: 256 * 1024 * 1024 });
const TYPES = new Set(['string', 'list', 'set', 'hash', 'zset']);

class MigrationError extends Error {
  constructor(code, message) { super(message); this.name = 'MigrationError'; this.code = code; }
}
function fail(code, message) { throw new MigrationError(code, message); }
function check(condition, code, message) { if (!condition) fail(code, message); }
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function limits(options = {}) {
  const out = { ...DEFAULT_LIMITS, ...options };
  for (const key of ['maxKeys', 'maxBytes']) check(Number.isSafeInteger(out[key]) && out[key] > 0, 'INVALID_LIMIT', 'Migration limits must be positive safe integers.');
  return out;
}
function encode(value) {
  check(Buffer.isBuffer(value), 'INVALID_REDIS_RESPONSE', 'The Redis connection must return binary data.');
  return value.toString('base64');
}
function decode(value) {
  check(typeof value === 'string' && Buffer.from(value, 'base64').toString('base64') === value, 'INVALID_ARCHIVE', 'Archive contains invalid binary encoding.');
  return Buffer.from(value, 'base64');
}
function compareEncoded(a, b) { return Buffer.compare(decode(a), decode(b)); }
function canonicalScore(value) {
  const text = Buffer.isBuffer(value) ? value.toString('ascii') : String(value);
  if (/^\+?inf(?:inity)?$/i.test(text)) return '+inf';
  if (/^-inf(?:inity)?$/i.test(text)) return '-inf';
  const number = Number(text);
  check(text.trim() !== '' && Number.isFinite(number), 'INVALID_REDIS_RESPONSE', 'Redis returned an invalid sorted-set score.');
  return Object.is(number, -0) ? '0' : String(number);
}
async function command(client, name, ...args) {
  try { return await client.callBuffer(name, ...args); }
  catch { fail('REDIS_COMMAND_FAILED', 'A Redis operation was rejected or unavailable. No connection details are logged.'); }
}
async function serverTime(client) {
  const value = await command(client, 'TIME');
  const ms = Array.isArray(value) && value.length === 2 ? Number(value[0]) * 1000 + Math.floor(Number(value[1]) / 1000) : NaN;
  check(Number.isSafeInteger(ms) && ms >= 0, 'INVALID_REDIS_RESPONSE', 'Redis returned an invalid server time.');
  return ms;
}
async function scanKeys(client, options = {}) {
  const { maxKeys } = limits(options);
  const keys = new Map();
  let cursor = '0', scans = 0;
  do {
    const page = await command(client, 'SCAN', cursor, 'COUNT', 256);
    check(Array.isArray(page) && page.length === 2 && Array.isArray(page[1]), 'INVALID_REDIS_RESPONSE', 'Redis returned an invalid key scan.');
    cursor = String(page[0]);
    check(/^\d+$/.test(cursor) && ++scans <= 1000000, 'INVALID_REDIS_RESPONSE', 'Redis key scan did not complete safely.');
    for (const key of page[1]) {
      keys.set(encode(key), key);
      check(keys.size <= maxKeys, 'EXPORT_LIMIT', 'The configured maximum number of keys was exceeded.');
    }
  } while (cursor !== '0');
  return [...keys.keys()].sort(compareEncoded);
}
async function hashEntries(client, key, options) {
  let cursor = '0', scans = 0;
  const fields = new Map();
  do {
    // HGETALL has an ioredis object reply transformer which can corrupt binary
    // field names. HSCAN returns the original flat buffer pairs instead.
    const page = await command(client, 'HSCAN', key, cursor, 'COUNT', 256);
    check(Array.isArray(page) && page.length === 2 && Array.isArray(page[1]) && page[1].length % 2 === 0, 'INVALID_REDIS_RESPONSE', 'Redis returned an invalid hash scan.');
    cursor = String(page[0]);
    check(/^\d+$/.test(cursor) && ++scans <= 1000000, 'INVALID_REDIS_RESPONSE', 'Redis hash scan did not complete safely.');
    for (let i = 0; i < page[1].length; i += 2) {
      const field = encode(page[1][i]), value = encode(page[1][i + 1]);
      check(!fields.has(field) || fields.get(field) === value, 'SOURCE_CHANGED', 'The source changed during export. Pause every writer and start a fresh export.');
      fields.set(field, value);
    }
    check(Buffer.byteLength(JSON.stringify([...fields])) <= options.maxBytes, 'EXPORT_LIMIT', 'A key exceeds the configured archive size limit.');
  } while (cursor !== '0');
  return [...fields].sort((a, b) => compareEncoded(a[0], b[0]));
}
async function readRecord(client, encodedKey, options = {}) {
  const cap = limits(options), key = decode(encodedKey);
  const rawType = await command(client, 'TYPE', key);
  const type = Buffer.isBuffer(rawType) ? rawType.toString('ascii') : String(rawType);
  if (type === 'none') return null;
  check(TYPES.has(type), 'UNSUPPORTED_TYPE', 'The database contains an unsupported key type. A complete migration was not made.');
  let data;
  if (type === 'string') {
    const size = Number(await command(client, 'STRLEN', key));
    check(Number.isSafeInteger(size) && size >= 0 && size <= cap.maxBytes, 'EXPORT_LIMIT', 'A string exceeds the configured archive size limit.');
    const value = await command(client, 'GET', key);
    if (value === null) return null;
    data = encode(value);
  } else if (type === 'hash') data = await hashEntries(client, key, cap);
  else {
    const operation = type === 'list' ? 'LRANGE' : type === 'set' ? 'SMEMBERS' : 'ZRANGE';
    const args = type === 'set' ? [] : type === 'zset' ? [0, -1, 'WITHSCORES'] : [0, -1];
    const values = await command(client, operation, key, ...args);
    check(Array.isArray(values), 'INVALID_REDIS_RESPONSE', 'Redis returned an invalid collection.');
    if (type === 'zset') {
      check(values.length % 2 === 0, 'INVALID_REDIS_RESPONSE', 'Redis returned an invalid sorted set.');
      data = [];
      for (let i = 0; i < values.length; i += 2) data.push([encode(values[i]), canonicalScore(values[i + 1])]);
      data.sort((a, b) => compareEncoded(a[0], b[0]));
    } else {
      data = values.map(encode);
      if (type === 'set') data.sort(compareEncoded);
    }
  }
  const expires = Number(await command(client, 'PEXPIRETIME', key));
  if (expires === -2) return null;
  check(expires === -1 || Number.isSafeInteger(expires) && expires >= 0, 'INVALID_REDIS_RESPONSE', 'Redis returned an invalid absolute expiry time.');
  const record = { key: encodedKey, type, expiresAt: expires === -1 ? null : expires, data };
  check(Buffer.byteLength(JSON.stringify(record)) <= cap.maxBytes, 'EXPORT_LIMIT', 'A key exceeds the configured archive size limit.');
  return record;
}
function snapshotBody(snapshot) {
  return { format: snapshot.format, version: snapshot.version, createdAt: snapshot.createdAt, sourcePaused: snapshot.sourcePaused, keyCount: snapshot.keyCount, records: snapshot.records };
}
function sealSnapshot(records, createdAt) {
  const snapshot = { format: FORMAT, version: VERSION, createdAt, sourcePaused: true, keyCount: records.length, records };
  return { ...snapshot, sha256: digest(snapshot) };
}
function validateSnapshot(snapshot, options = {}) {
  const cap = limits(options);
  check(snapshot && snapshot.format === FORMAT && snapshot.version === VERSION && snapshot.sourcePaused === true && Number.isSafeInteger(snapshot.createdAt) && snapshot.createdAt >= 0 && Array.isArray(snapshot.records) && snapshot.keyCount === snapshot.records.length, 'INVALID_ARCHIVE', 'Archive format or metadata is invalid.');
  check(snapshot.records.length <= cap.maxKeys && Buffer.byteLength(JSON.stringify(snapshot)) <= cap.maxBytes, 'EXPORT_LIMIT', 'Archive exceeds the configured limits.');
  check(snapshot.sha256 === digest(snapshotBody(snapshot)), 'CHECKSUM_MISMATCH', 'Archive checksum does not match. No destination writes were attempted.');
  let previous;
  for (const record of snapshot.records) {
    check(record && TYPES.has(record.type) && (record.expiresAt === null || Number.isSafeInteger(record.expiresAt) && record.expiresAt >= 0), 'INVALID_ARCHIVE', 'Archive key type or expiry is invalid.');
    decode(record.key);
    check(previous === undefined || compareEncoded(previous, record.key) < 0, 'INVALID_ARCHIVE', 'Archive key order or uniqueness is invalid.');
    previous = record.key;
    if (record.type === 'string') decode(record.data);
    else {
      check(Array.isArray(record.data) && record.data.length > 0, 'INVALID_ARCHIVE', 'Archive contains an invalid empty collection.');
      let prior;
      for (const entry of record.data) {
        const paired = record.type === 'hash' || record.type === 'zset';
        if (paired) check(Array.isArray(entry) && entry.length === 2, 'INVALID_ARCHIVE', 'Archive contains invalid collection entries.');
        const field = paired ? entry[0] : entry;
        decode(field);
        if (record.type === 'hash') decode(entry[1]);
        if (record.type === 'zset') check(typeof entry[1] === 'string' && canonicalScore(entry[1]) === entry[1], 'INVALID_ARCHIVE', 'Archive contains an invalid sorted-set score.');
        if (record.type !== 'list') check(prior === undefined || compareEncoded(prior, field) < 0, 'INVALID_ARCHIVE', 'Archive collection order or uniqueness is invalid.');
        prior = field;
      }
    }
  }
  return snapshot;
}
async function exportSnapshot(source, options = {}) {
  check(options.sourcePaused === true, 'WRITERS_NOT_PAUSED', 'Confirm that every source writer is paused before export.');
  const cap = limits(options);
  const createdAt = await serverTime(source), keys = await scanKeys(source, cap), records = [];
  let bytes = 512;
  for (const key of keys) {
    const record = await readRecord(source, key, cap);
    check(record !== null, 'SOURCE_CHANGED', 'A source key disappeared during export. Keep all writers paused and start a fresh export.');
    bytes += Buffer.byteLength(JSON.stringify(record)) + 1;
    check(bytes <= cap.maxBytes, 'EXPORT_LIMIT', 'Export exceeds the configured archive size limit.');
    records.push(record);
  }
  const after = await scanKeys(source, cap);
  check(keys.length === after.length && keys.every((key, i) => key === after[i]), 'SOURCE_CHANGED', 'The source key set changed during export. Keep all writers paused and start a fresh export.');
  return validateSnapshot(sealSnapshot(records, createdAt), cap);
}
function isLive(record, now) { return record.expiresAt === null || record.expiresAt > now; }
async function verifySnapshot(destination, rawSnapshot, options = {}) {
  check(options.destinationIsolated === true, 'DESTINATION_NOT_ISOLATED', 'Keep the destination isolated from application writers during verification.');
  const cap = limits(options), snapshot = validateSnapshot(rawSnapshot, cap);
  const keys = await scanKeys(destination, cap), actual = [];
  for (const key of keys) {
    const record = await readRecord(destination, key, cap);
    if (record) actual.push(record);
  }
  const now = await serverTime(destination);
  const snapshotKeys = new Map(snapshot.records.map(record => [record.key, record]));
  const expected = snapshot.records.filter(record => isLive(record, now));
  const liveActual = actual.filter(record => isLive(record, now));
  const finalKeys = (await scanKeys(destination, cap)).filter(key => {
    const record = snapshotKeys.get(key);
    return !record || isLive(record, now);
  });
  check(finalKeys.length === expected.length && finalKeys.every((key, i) => key === expected[i].key), 'VERIFICATION_FAILED', 'Destination key counts or key set do not match the archive.');
  check(digest(liveActual) === digest(expected), 'VERIFICATION_FAILED', 'Destination content or absolute expiry does not match the archive.');
  return { verifiedKeys: expected.length, expiredKeys: snapshot.keyCount - expected.length, contentSha256: digest(expected) };
}
function addCollection(transaction, record, key) {
  const chunk = 256;
  const operation = { list: 'RPUSH', set: 'SADD', hash: 'HSET', zset: 'ZADD' }[record.type];
  for (let i = 0; i < record.data.length; i += chunk) {
    const entries = record.data.slice(i, i + chunk);
    const args = record.type === 'hash' ? entries.flatMap(([field, value]) => [decode(field), decode(value)])
      : record.type === 'zset' ? entries.flatMap(([member, score]) => [score, decode(member)]) : entries.map(decode);
    transaction.call(operation, key, ...args);
  }
}
async function importSnapshot(destination, rawSnapshot, options = {}) {
  check(options.destinationIsolated === true, 'DESTINATION_NOT_ISOLATED', 'Confirm that the destination has no application writers before import.');
  const cap = limits(options), snapshot = validateSnapshot(rawSnapshot, cap);
  check(Number(await command(destination, 'DBSIZE')) === 0, 'DESTINATION_NOT_EMPTY', 'The destination database is not empty. Nothing was overwritten; use an empty isolated destination.');
  let importedKeys = 0, skippedExpiredKeys = 0;
  for (const record of snapshot.records) {
    if (!isLive(record, await serverTime(destination))) { skippedExpiredKeys++; continue; }
    const key = decode(record.key);
    await command(destination, 'WATCH', key);
    try {
      check(Number(await command(destination, 'EXISTS', key)) === 0, 'DESTINATION_CHANGED', 'A destination key was created by another writer. Stop and inspect the partial import.');
      const transaction = destination.multi();
      if (record.type === 'string') transaction.call('SET', key, decode(record.data), 'NX');
      else addCollection(transaction, record, key);
      if (record.expiresAt !== null) transaction.call('PEXPIREAT', key, record.expiresAt);
      let result;
      try { result = await transaction.exec(); }
      catch { fail('IMPORT_FAILED', 'Import stopped. The destination may contain a partial import; do not retry against it.'); }
      check(Array.isArray(result) && result.length > 0 && result.every(item => Array.isArray(item) && item.length === 2 && !item[0] && item[1] !== null), 'IMPORT_FAILED', 'A transaction failed or another writer changed the destination. Inspect the partial import before any retry.');
      importedKeys++;
    } finally { try { await command(destination, 'UNWATCH'); } catch {} }
  }
  const verified = await verifySnapshot(destination, snapshot, { ...cap, destinationIsolated: true });
  return { importedKeys, skippedExpiredKeys, ...verified };
}
function archivePath(file, cwd = process.cwd()) {
  const data = path.resolve(cwd, 'data'), full = path.resolve(cwd, file || 'data/redis-migration.json'), relative = path.relative(data, full);
  check(relative && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative), 'ARCHIVE_LOCATION', 'Migration archives must be saved inside the ignored data directory.');
  return { data, full };
}
async function safeArchiveParents(data, parent) {
  let current = data;
  for (const part of ['', ...path.relative(data, parent).split(path.sep).filter(Boolean)]) {
    if (part) current = path.join(current, part);
    let stat;
    try { stat = await fs.lstat(current); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await fs.mkdir(current, { mode: 0o700 });
      stat = await fs.lstat(current);
    }
    check(stat.isDirectory() && !stat.isSymbolicLink(), 'ARCHIVE_LOCATION', 'Archive directories must be ordinary local directories.');
  }
}
async function writeSnapshot(file, snapshot, options = {}) {
  validateSnapshot(snapshot, options);
  const { data, full } = archivePath(file, options.cwd);
  await safeArchiveParents(data, path.dirname(full));
  let handle;
  try {
    handle = await fs.open(full, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(snapshot) + '\n', 'utf8');
    await handle.sync();
  } catch (error) {
    if (error instanceof MigrationError) throw error;
    fail(error.code === 'EEXIST' ? 'ARCHIVE_EXISTS' : 'ARCHIVE_WRITE_FAILED', error.code === 'EEXIST' ? 'Archive already exists; choose a new name. Existing archives are never overwritten.' : 'The private archive could not be saved.');
  } finally { if (handle) await handle.close(); }
  return full;
}
async function readSnapshot(file, options = {}) {
  const cap = limits(options), { data, full } = archivePath(file, options.cwd);
  await safeArchiveParents(data, path.dirname(full));
  try {
    const stat = await fs.lstat(full);
    check(stat.isFile() && !stat.isSymbolicLink() && stat.size <= cap.maxBytes, 'INVALID_ARCHIVE', 'Archive file type or size is invalid.');
    if (process.platform !== 'win32') check((stat.mode & 0o077) === 0, 'ARCHIVE_PERMISSIONS', 'Archive permissions must allow access only to its owner.');
    return validateSnapshot(JSON.parse(await fs.readFile(full, 'utf8')), cap);
  } catch (error) {
    if (error instanceof MigrationError) throw error;
    fail('ARCHIVE_READ_FAILED', 'The private archive could not be read.');
  }
}
function normalizeRedisUrl(value) {
  let parsed;
  try { parsed = new URL(String(value || '').replace(/^valkeys:/i, 'rediss:').replace(/^valkey:/i, 'redis:')); }
  catch { fail('INVALID_CONNECTION', 'A valid Redis connection URL is required in the appropriate environment variable.'); }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const loopback = host === 'localhost' || host === '::1' || net.isIP(host) === 4 && host.startsWith('127.');
  check(['redis:', 'rediss:'].includes(parsed.protocol) && (parsed.protocol === 'rediss:' || loopback), 'TLS_REQUIRED', 'Remote Redis connections must use TLS; valkeys:// and rediss:// are accepted.');
  check(parsed.hostname && !parsed.search && !parsed.hash && /^\/\d*$|^$/.test(parsed.pathname), 'INVALID_CONNECTION', 'Redis connection URL must contain only the host, credentials and optional database index.');
  return parsed.href;
}
async function connectRedis(value, ca) {
  const url = normalizeRedisUrl(value);
  let client;
  try {
    const Redis = require('ioredis');
    client = new Redis(url, { lazyConnect: true, retryStrategy: null, maxRetriesPerRequest: 0, connectTimeout: 10000, commandTimeout: 15000, enableOfflineQueue: false, autoResendUnfulfilledCommands: false, autoResubscribe: false, ...(url.startsWith('rediss:') ? { tls: { rejectUnauthorized: true, ...(ca ? { ca: String(ca).replace(/\\n/g, '\n') } : {}) } } : {}) });
    client.on('error', () => {});
    await client.connect();
    return client;
  } catch { client?.disconnect(); fail('CONNECTION_FAILED', 'The Redis connection could not be established. Check its URL, TLS certificate and provider status privately.'); }
}
async function main(argv = process.argv.slice(2), env = process.env) {
  check(argv.length === 1 && ['export', 'import', 'verify'].includes(argv[0]), 'USAGE', 'Usage: node scripts/migrate-redis.cjs export|import|verify. Supply connection URLs only through environment variables.');
  const action = argv[0], file = env.REDIS_MIGRATION_ARCHIVE || 'data/redis-migration.json';
  const options = { sourcePaused: env.REDIS_MIGRATION_SOURCE_PAUSED === 'yes', destinationIsolated: env.REDIS_MIGRATION_DESTINATION_ISOLATED === 'yes' };
  if (action === 'export') check(options.sourcePaused, 'WRITERS_NOT_PAUSED', 'Set REDIS_MIGRATION_SOURCE_PAUSED=yes only after all source writers have been paused.');
  else check(options.destinationIsolated, 'DESTINATION_NOT_ISOLATED', 'Set REDIS_MIGRATION_DESTINATION_ISOLATED=yes only while the destination has no application writers.');
  let client;
  try {
    if (action === 'export') {
      client = await connectRedis(env.REDIS_MIGRATION_SOURCE_URL, env.REDIS_MIGRATION_SOURCE_CA_CERT || env.MIGRATION_SOURCE_CA_CERT);
      const snapshot = await exportSnapshot(client, options);
      await writeSnapshot(file, snapshot);
      return { ok: true, action, keys: snapshot.keyCount, sha256: snapshot.sha256 };
    }
    const snapshot = await readSnapshot(file);
    client = await connectRedis(env.REDIS_MIGRATION_DESTINATION_URL, env.REDIS_MIGRATION_DESTINATION_CA_CERT || env.MIGRATION_DESTINATION_CA_CERT);
    return { ok: true, action, ...(await (action === 'import' ? importSnapshot : verifySnapshot)(client, snapshot, options)) };
  } finally { client?.disconnect(); }
}
module.exports = { MigrationError, exportSnapshot, importSnapshot, verifySnapshot, validateSnapshot, sealSnapshot, readRecord, scanKeys, writeSnapshot, readSnapshot, normalizeRedisUrl, main };
if (require.main === module) main().then(result => console.log(JSON.stringify(result))).catch(error => {
  console.error(JSON.stringify({ ok: false, code: error instanceof MigrationError ? error.code : 'MIGRATION_FAILED', error: error instanceof MigrationError ? error.message : 'Migration stopped. No connection details, keys or values are logged.' }));
  process.exitCode = 1;
});
