'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { exportSnapshot, importSnapshot, verifySnapshot, sealSnapshot, validateSnapshot, writeSnapshot, readSnapshot, normalizeRedisUrl } = require('../scripts/migrate-redis.cjs');

const b64 = value => Buffer.from(value).toString('base64');
const binary = value => Buffer.from(value, 'base64');
const record = (key, type, data, expiresAt = null) => ({ key: b64(key), type, expiresAt, data });
const order = records => records.sort((a, b) => Buffer.compare(binary(a.key), binary(b.key)));

class MemoryRedis {
  constructor(records = []) {
    this.records = new Map(records.map(item => [item.key, structuredClone(item)]));
    this.now = 100000;
    this.writes = 0;
    this.scans = 0;
  }
  expire() { for (const [key, item] of this.records) if (item.expiresAt !== null && item.expiresAt <= this.now) this.records.delete(key); }
  async callBuffer(name, ...args) {
    this.expire();
    if (name === 'TIME') return [Buffer.from(String(Math.floor(this.now / 1000))), Buffer.from(String(this.now % 1000 * 1000))];
    if (name === 'SCAN') { this.scans++; this.onScan?.(this.scans); return [Buffer.from('0'), [...this.records.keys()].map(binary)]; }
    if (name === 'DBSIZE') return this.records.size;
    const key = Buffer.isBuffer(args[0]) ? args[0].toString('base64') : b64(String(args[0]));
    const item = this.records.get(key);
    if (name === 'WATCH' || name === 'UNWATCH') return Buffer.from('OK');
    if (name === 'EXISTS') return item ? 1 : 0;
    if (name === 'TYPE') return Buffer.from(item?.type || 'none');
    if (name === 'PEXPIRETIME') return item ? item.expiresAt ?? -1 : -2;
    if (name === 'STRLEN') return item ? binary(item.data).length : 0;
    if (name === 'GET') return item ? binary(item.data) : null;
    if (name === 'LRANGE' || name === 'SMEMBERS') return item ? item.data.map(binary) : [];
    if (name === 'HSCAN') return [Buffer.from('0'), item ? item.data.flatMap(([field, value]) => [binary(field), binary(value)]) : []];
    if (name === 'ZRANGE') return item ? item.data.flatMap(([member, score]) => [binary(member), Buffer.from(score)]) : [];
    throw new Error('Unexpected fake Redis operation');
  }
  multi() {
    const queued = [];
    const transaction = {
      call: (...parts) => { queued.push(parts); return transaction; },
      exec: async () => {
        if (this.abortTransaction) return null;
        const replies = [];
        for (const [name, rawKey, ...args] of queued) {
          this.writes++;
          const key = rawKey.toString('base64');
          let item = this.records.get(key);
          if (name === 'SET') {
            if (item) { replies.push([null, null]); continue; }
            this.records.set(key, { key, type: 'string', expiresAt: null, data: args[0].toString('base64') });
            replies.push([null, 'OK']);
          } else if (name === 'PEXPIREAT') {
            if (item) item.expiresAt = args[0];
            replies.push([null, item ? 1 : 0]);
          } else {
            const type = { RPUSH: 'list', SADD: 'set', HSET: 'hash', ZADD: 'zset' }[name];
            assert.ok(type);
            if (!item) { item = { key, type, data: [], expiresAt: null }; this.records.set(key, item); }
            if (type === 'list' || type === 'set') item.data.push(...args.map(value => value.toString('base64')));
            else for (let i = 0; i < args.length; i += 2) item.data.push(type === 'hash' ? [args[i].toString('base64'), args[i + 1].toString('base64')] : [args[i + 1].toString('base64'), String(args[i])]);
            replies.push([null, 1]);
          }
        }
        return replies;
      }
    };
    return transaction;
  }
}

function examples() {
  return order([
    record('membership-user', 'string', b64('{"passwordHash":"existing-hash","paidUntilMs":999999}')),
    record('membership-session', 'string', b64('{"userId":"same-user"}'), 200000),
    record('hyperloglog', 'string', Buffer.from([0x48, 0x59, 0x4c, 0x4c, 0, 255, 128]).toString('base64')),
    record('ordered', 'list', [b64('second'), b64('first')]),
    record('members', 'set', [b64('a'), b64('b')]),
    record('support', 'hash', [[b64('conversation'), b64('saved message')], [Buffer.from([0, 255]).toString('base64'), b64('binary field')]]),
    record('presence', 'zset', [[b64('a'), '12.5'], [b64('b'), '+inf']])
  ]);
}

test('logical migration preserves all app types, binary values, sessions and absolute expiry without writing source', async () => {
  const source = new MemoryRedis(examples()), destination = new MemoryRedis();
  const snapshot = await exportSnapshot(source, { sourcePaused: true });
  const result = await importSnapshot(destination, snapshot, { destinationIsolated: true });
  assert.equal(result.verifiedKeys, examples().length);
  assert.equal(result.skippedExpiredKeys, 0);
  assert.equal(source.writes, 0);
  assert.deepEqual((await exportSnapshot(destination, { sourcePaused: true })).records, snapshot.records);
  assert.deepEqual(await verifySnapshot(destination, snapshot, { destinationIsolated: true }), {
    verifiedKeys: examples().length, expiredKeys: 0, contentSha256: result.contentSha256
  });
});

test('migration requires paused writers and an isolated destination', async () => {
  await assert.rejects(exportSnapshot(new MemoryRedis()), { code: 'WRITERS_NOT_PAUSED' });
  const snapshot = sealSnapshot(order([record('user', 'string', b64('saved'))]), 100000);
  await assert.rejects(importSnapshot(new MemoryRedis(), snapshot), { code: 'DESTINATION_NOT_ISOLATED' });
  await assert.rejects(verifySnapshot(new MemoryRedis(), snapshot), { code: 'DESTINATION_NOT_ISOLATED' });
});

test('corrupt archives and nonempty destinations are rejected before writes', async () => {
  const destination = new MemoryRedis([record('existing', 'string', b64('keep'))]);
  const snapshot = sealSnapshot(order([record('user', 'string', b64('saved'))]), 100000);
  await assert.rejects(importSnapshot(destination, snapshot, { destinationIsolated: true }), { code: 'DESTINATION_NOT_EMPTY' });
  const corrupt = structuredClone(snapshot);
  corrupt.records[0].data = b64('changed');
  await assert.rejects(importSnapshot(destination, corrupt, { destinationIsolated: true }), { code: 'CHECKSUM_MISMATCH' });
  assert.equal(destination.writes, 0);
  assert.equal(binary(destination.records.get(b64('existing')).data).toString(), 'keep');
});

test('expired records are not revived and changed destination content fails verification', async () => {
  const snapshot = sealSnapshot(order([record('expired-session', 'string', b64('old'), 90000), record('member', 'string', b64('keep'))]), 80000);
  const destination = new MemoryRedis();
  const result = await importSnapshot(destination, snapshot, { destinationIsolated: true });
  assert.equal(result.verifiedKeys, 1);
  assert.equal(result.skippedExpiredKeys, 1);
  assert.equal(destination.records.has(b64('expired-session')), false);
  destination.records.get(b64('member')).data = b64('wrong');
  await assert.rejects(verifySnapshot(destination, snapshot, { destinationIsolated: true }), { code: 'VERIFICATION_FAILED' });
});

test('changed source keyset and unknown types stop export', async () => {
  const source = new MemoryRedis([record('user', 'string', b64('saved'))]);
  source.onScan = count => { if (count === 2) source.records.set(b64('new'), record('new', 'string', b64('new'))); };
  await assert.rejects(exportSnapshot(source, { sourcePaused: true }), { code: 'SOURCE_CHANGED' });
  await assert.rejects(exportSnapshot(new MemoryRedis([record('stream', 'stream', [])]), { sourcePaused: true }), { code: 'UNSUPPORTED_TYPE' });
  assert.equal(source.writes, 0);
});

test('aborted destination transaction stops and does not silently retry', async () => {
  const destination = new MemoryRedis();
  destination.abortTransaction = true;
  const snapshot = sealSnapshot(order([record('user', 'string', b64('saved'))]), 100000);
  await assert.rejects(importSnapshot(destination, snapshot, { destinationIsolated: true }), { code: 'IMPORT_FAILED' });
  assert.equal(destination.writes, 0);
});

test('TLS URLs normalize without allowing remote plaintext or connection option overrides', () => {
  assert.match(normalizeRedisUrl('valkeys://default:secret@db.example:1234'), /^rediss:\/\//);
  assert.match(normalizeRedisUrl('redis://127.0.0.1:6379/0'), /^redis:\/\//);
  for (const value of ['redis://db.example:6379', 'https://db.example', 'rediss://db.example:1234?tls=false', 'rediss://db.example/not-a-database']) {
    assert.throws(() => normalizeRedisUrl(value), { name: 'MigrationError' });
  }
});

test('archive files stay in ignored data and never overwrite an existing export', async () => {
  const workspace = path.resolve(__dirname, '..');
  const root = path.join(workspace, 'data', 'migration-test-' + crypto.randomUUID());
  await fs.mkdir(root, { recursive: true });
  const full = path.join(root, 'data', 'test.json');
  const snapshot = sealSnapshot(order([record('user', 'string', b64('private'))]), 100000);
  try {
    assert.equal(validateSnapshot(snapshot), snapshot);
    await writeSnapshot('data/test.json', snapshot, { cwd: root });
    assert.deepEqual(await readSnapshot('data/test.json', { cwd: root }), snapshot);
    await assert.rejects(writeSnapshot('data/test.json', snapshot, { cwd: root }), { code: 'ARCHIVE_EXISTS' });
    await assert.rejects(writeSnapshot('../unsafe.json', snapshot, { cwd: root }), { code: 'ARCHIVE_LOCATION' });
  } finally {
    assert.ok(root.startsWith(path.join(workspace, 'data', 'migration-test-')));
    await fs.unlink(full).catch(() => {});
    await fs.rmdir(path.dirname(full)).catch(() => {});
    await fs.rmdir(root);
  }
});
