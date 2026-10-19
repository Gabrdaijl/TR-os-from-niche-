'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createReports } = require('../reports.cjs');

test('seen reports are atomically moved to a private expiring Redis archive', async () => {
  let command;
  const reports = createReports({ KV_REST_API_URL: 'https://redis.example', KV_REST_API_TOKEN: 'test-token' }, async (_url, init) => {
    command = JSON.parse(init.body);
    return { ok: true, json: async () => ({ result: 1 }) };
  });
  const id = '9e2fb72a-143c-45d6-a471-0788b1573c4e';
  assert.deepEqual(await reports.archive(id), { archived: true });
  assert.equal(command[0], 'EVAL');
  assert.equal(command[2], 2);
  assert.match(command[3], /tros:reports}:v1:index/);
  assert.match(command[4], /tros:reports}:v1:archive:index/);
  assert.match(command[5], new RegExp(id.replaceAll('-', '\\-')));
  assert.match(command[1], /ZREM/);
  assert.match(command[1], /DEL/);
  assert.match(command[1], /archive/);
  assert.equal(command[6], 30 * 24 * 60 * 60);
  assert.match(command[7], /archive:/);
});

test('invalid report IDs are rejected before database access', async () => {
  const reports = createReports({ KV_REST_API_URL: 'https://redis.example', KV_REST_API_TOKEN: 'test-token' }, async () => {
    throw new Error('Must not call Redis');
  });
  await assert.rejects(reports.archive('../public'), { status: 404 });
});
