const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readSessionStream } = require('../cloud-stream.js');

test('cloud session consumes a final JSON message without a newline', async () => {
  const messages = [];
  const status = await readSessionStream(new Response('{"status":"account_ready"}\n{"status":"finished_queue","uuid":"session"}'), msg => messages.push(msg));
  assert.equal(status, 'finished_queue');
  assert.equal(messages[1].uuid, 'session');
});
test('cloud queue is a valid result rather than a premature stream error', async () => {
  const messages = [];
  const status = await readSessionStream(new Response('data: {"status":"queue","uuid":"session","queue_pos":2}\n'), msg => messages.push(msg));
  assert.equal(status, 'queue');
  assert.equal(messages[0].queue_pos, 2);
});
test('cloud stream assembles JSON split across network chunks', async () => {
  const encoder = new TextEncoder();
  const response = new Response(new ReadableStream({ start(controller) {
    controller.enqueue(encoder.encode('{"status":"finished_'));
    controller.enqueue(encoder.encode('queue","uuid":"split"}\n'));
    controller.close();
  } }));
  let session;
  assert.equal(await readSessionStream(response, msg => { session = msg.uuid; }), 'finished_queue');
  assert.equal(session, 'split');
});
