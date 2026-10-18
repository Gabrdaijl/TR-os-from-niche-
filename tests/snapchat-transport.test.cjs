'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../snapchat.js'), 'utf8');

async function startup(diagnostics = false) {
  const elements = new Map(['status', 'message', 'player', 'retry'].map(id => [id, {
    hidden: false, textContent: '', addEventListener() {}, contentWindow: { location: { href: 'about:blank' } }
  }]));
  const logs = [], connects = [], requests = [], navigation = [], bridgeInstalls = [];
  const send = () => {}, close = () => {}, tuple = [send, close];
  const nativeClient = Object.freeze({ user_agent: 'DEFAULT_BROWSER_UA' });
  let instance, configuration;
  class Epoxy {
    constructor(options) { this.opts = Object.freeze(options); instance = this; }
    async init() { this.client = nativeClient; this.ready = true; }
    connect(...args) { connects.push(args); return tuple; }
    async request(...args) {
      requests.push(args);
      return { status: 403, body: 'RESPONSE_BODY_SECRET', headers: [['Set-Cookie', 'RESPONSE_COOKIE_SECRET']] };
    }
  }
  class Controller {
    constructor(options) { configuration = options; assert.equal(options.transport.ready, true); }
    async wait() {}
    createFrame() { return { go: url => navigation.push(url) }; }
  }
  const controller = { Controller };
  const location = new URL('https://tr-os.test/snapchat.html' + (diagnostics ? '?diagnostics=1' : ''));
  const sandbox = {
    URL, navigator: { serviceWorker: { controller: Object.freeze({ type: 'actual-worker-object' }) } }, location,
    document: { getElementById: id => elements.get(id) },
    TR_OS: { async ensureServiceWorker() {}, wispUrl: () => 'wss://tr-os.test/wisp-vps/', withTimeout: promise => promise },
    TR_OS_SNAP_WORKER: { install: target => bridgeInstalls.push(target) },
    $scramjetController: controller, EpoxyTransport: { default: Epoxy },
    console: { info: (...args) => logs.push(args), error: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
    setInterval() { return 1; }, clearInterval() {},
    window: { addEventListener() {} }, parent: { postMessage() {} }
  };
  await vm.runInNewContext(source, sandbox, { filename: 'actual-snapchat.js' });
  assert.equal(elements.get('message').textContent, '', 'Startup should reach the frame rather than catch an error');
  assert.deepEqual(navigation, ['https://web.snapchat.com/']);
  assert.deepEqual(bridgeInstalls, [controller]);
  return { transport: instance, configuration, nativeClient, tuple, logs, connects, requests };
}

test('Snapchat startup removes duplicate caller UA only and preserves Epoxy default and socket callbacks', async () => {
  const h = await startup();
  const target = new URL('wss://chat.example.test:8443/socket/path?token=URL_QUERY_SECRET');
  const originalUrl = target.href;
  const protocols = ['PROTOCOL_VALUE_SECRET'];
  const origin = ['Origin', 'https://origin.example.test'];
  const cookie = ['Cookie', 'COOKIE_VALUE_SECRET'];
  const other = ['X-Client-Header', 'CLIENT_VALUE_SECRET'];
  const headers = [['User-Agent', 'CALLER_UA_SECRET'], origin, ['uSeR-aGeNt', 'DUPLICATE_UA_SECRET'], cookie, other];
  const originalHeaders = headers.map(header => header.slice());
  const received = [];
  const callbacks = [
    (...args) => received.push(['open', ...args]), (...args) => received.push(['data', ...args]),
    (...args) => received.push(['close', ...args]), (...args) => received.push(['error', ...args])
  ];
  assert.equal(h.transport.connect(target, protocols, headers, ...callbacks), h.tuple);
  const sent = h.connects[0];
  assert.notEqual(sent[0], target, 'Only a backend URL copy may be normalized');
  assert.equal(sent[0].protocol, 'https:');
  assert.equal(sent[0].hostname, target.hostname); assert.equal(sent[0].port, '8443');
  assert.equal(sent[0].pathname, target.pathname); assert.equal(sent[0].search, target.search);
  assert.equal(target.href, originalUrl, 'The frontend WebSocket URL must stay wss');
  assert.equal(sent[1], protocols);
  assert.equal(sent[2].length, 3);
  assert.equal(sent[2][0], origin); assert.equal(sent[2][1], cookie); assert.equal(sent[2][2], other);
  assert.deepEqual(headers, originalHeaders, 'The caller header array must remain intact');
  sent[3]('selected-protocol', 'extensions'); sent[4]('message'); sent[5](1000, 'closed'); sent[6]('failure');
  assert.deepEqual(received, [['open', 'selected-protocol', 'extensions'], ['data', 'message'], ['close', 1000, 'closed'], ['error', 'failure']]);
  assert.equal(h.transport.client, h.nativeClient);
  assert.equal(h.transport.client.user_agent, 'DEFAULT_BROWSER_UA');
  assert.deepEqual(Object.keys(h.transport.opts), ['wisp']);
  assert.equal(h.transport.opts.wisp, 'wss://tr-os.test/wisp-vps/');
  assert.equal(h.configuration.transport, h.transport);
  assert.deepEqual(h.logs, []);
});

test('socket backend scheme mapping preserves endpoint and original URL for secure and plaintext sockets', async () => {
  const h = await startup();
  for (const [input, scheme] of [
    ['wss://chat.example.test:9443/socket/secure?token=SECURE_QUERY_SECRET', 'https:'],
    ['ws://chat.example.test:9080/socket/plain?token=PLAIN_QUERY_SECRET', 'http:']
  ]) {
    const target = new URL(input);
    const headers = [['Origin', 'https://origin.example.test'], ['Cookie', 'COOKIE_VALUE_SECRET']];
    const protocols = ['PROTOCOL_VALUE_SECRET'];
    h.transport.connect(target, protocols, headers, () => {}, () => {}, () => {}, () => {});
    const [backend, passedProtocols, passedHeaders] = h.connects.at(-1);
    assert.notEqual(backend, target);
    assert.equal(backend.protocol, scheme);
    assert.equal(backend.hostname, target.hostname); assert.equal(backend.port, target.port);
    assert.equal(backend.pathname, target.pathname); assert.equal(backend.search, target.search);
    assert.equal(target.href, input);
    assert.equal(passedProtocols, protocols);
    assert.equal(passedHeaders[0], headers[0]); assert.equal(passedHeaders[1], headers[1]);
  }
  assert.equal(h.transport.client, h.nativeClient, 'URL normalization must not replace native TLS/client configuration');
});

test('UA fix leaves HTTP request headers, body and response untouched when diagnostics are off', async () => {
  const h = await startup();
  const target = new URL('https://chat.example.test/api?token=HTTP_QUERY_SECRET');
  const headers = [['User-Agent', 'HTTP_UA_SECRET'], ['Cookie', 'HTTP_COOKIE_SECRET']];
  const body = new Uint8Array([1, 2, 3]);
  const response = await h.transport.request(target, 'POST', body, headers);
  assert.equal(h.requests[0][0], target); assert.equal(h.requests[0][2], body); assert.equal(h.requests[0][3], headers);
  assert.equal(response.status, 403); assert.equal(response.body, 'RESPONSE_BODY_SECRET');
  assert.deepEqual(h.logs, []);
});

test('opt-in diagnostics contain connection metadata and forward all payloads without logging secrets', async () => {
  const h = await startup(true);
  const target = new URL('wss://user:URL_PASSWORD_SECRET@chat.example.test/socket/PRIVATE_PATH_SECRET?token=QUERY_SECRET#HASH_SECRET');
  const protocols = ['PROTOCOL_VALUE_SECRET'];
  const headers = [['Cookie', 'COOKIE_VALUE_SECRET'], ['Authorization', 'AUTH_VALUE_SECRET'],
    ['Origin', 'https://user:ORIGIN_PASSWORD_SECRET@origin.example.test/private?secret=ORIGIN_QUERY_SECRET'],
    ['User-Agent', 'UA_VALUE_SECRET']];
  const received = [];
  const result = h.transport.connect(target, protocols, headers,
    (...args) => received.push(['open', ...args]), (...args) => received.push(['message', ...args]),
    (...args) => received.push(['close', ...args]), (...args) => received.push(['error', ...args]));
  assert.equal(result, h.tuple);
  const sent = h.connects[0];
  assert.equal(sent[1], protocols);
  assert.equal(sent[2].some(([name]) => name.toLowerCase() === 'user-agent'), false);
  sent[3]('SELECTED_PROTOCOL_SECRET', 'EXTENSION_VALUE_SECRET');
  sent[4]('CHAT_MESSAGE_SECRET');
  sent[5](1000, 'CLOSE_REASON_SECRET');
  sent[6]('Invalid websocket response status code: 400 != 101 RAW_ERROR_SECRET');
  const body = 'REQUEST_BODY_SECRET';
  await h.transport.request(new URL('https://http.example.test/private?token=HTTP_QUERY_SECRET'), 'POST', body, headers);
  const metadata = h.logs.map(([label, payload]) => {
    assert.equal(typeof payload, 'string', 'Browser-readable diagnostics must serialize metadata as JSON');
    return [label, JSON.parse(payload)];
  });
  const start = metadata.find(([label]) => label === 'TR-os Snapchat socket start')?.[1];
  assert.ok(start);
  assert.deepEqual(Object.keys(start).sort(), ['headers', 'host', 'originHost', 'protocols', 'scheme']);
  assert.equal(start.host, 'chat.example.test'); assert.equal(start.scheme, 'wss:');
  assert.equal(start.originHost, 'origin.example.test'); assert.equal(start.protocols, 1);
  assert.ok(start.headers.includes('cookie') && start.headers.includes('authorization'));
  assert.equal(JSON.stringify(h.logs).includes('SECRET'), false);
  assert.ok(h.logs.some(([label]) => label === 'TR-os Snapchat socket open'));
  assert.ok(h.logs.some(([label]) => label === 'TR-os Snapchat socket failed'));
  assert.ok(metadata.some(([label, info]) => label === 'TR-os Snapchat HTTP' && info.host === 'http.example.test' && info.status === 403));
  assert.equal(received[1][1], 'CHAT_MESSAGE_SECRET');
  assert.equal(received[2][2], 'CLOSE_REASON_SECRET');
  assert.equal(received[3][1], 'Invalid websocket response status code: 400 != 101 RAW_ERROR_SECRET');
});
