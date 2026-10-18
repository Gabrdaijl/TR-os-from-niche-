'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../snapchat.js'), 'utf8');

async function startup(diagnostics = false, options = {}) {
  const elements = new Map(['status', 'message', 'player', 'retry'].map(id => [id, {
    hidden: false, textContent: '', addEventListener() {}, contentWindow: { location: { href: 'about:blank' } }
  }]));
  const logs = [], connects = [], requests = [], navigation = [], bridgeInstalls = [], scripts = [], curlConnects = [], curlRequests = [], curlSends = [], curlCloses = [];
  const timers = new Map(); let nextTimer = 0, curlInstance;
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
  class Curl {
    constructor(value) { this.opts = value; curlInstance = this; }
    async init() { if (options.curlInitError) throw options.curlInitError; this.ready = true; }
    connect(...args) { curlConnects.push(args); return [data => curlSends.push(data), (...closeArgs) => {
      curlCloses.push(closeArgs);
      return options.rejectCurlClose ? Promise.reject(new Error('Controlled close rejection')) : Promise.resolve();
    }]; }
    async request(...args) {
      curlRequests.push(args);
      if (args[0].hostname === 'self-signed.badssl.com') {
        if (options.badCertificateError) throw options.badCertificateError;
        if (options.acceptUntrusted !== true) throw new Error('SSL peer certificate cannot be authenticated');
      }
      return { status: options.validTlsStatus || 200 };
    }
  }
  const controller = { Controller };
  const location = new URL('https://tr-os.test/snapchat.html');
  if (diagnostics) location.searchParams.set('diagnostics', '1');
  if (options.curl) location.searchParams.set('socket', 'curl');
  else if (!options.actualDefault) location.searchParams.set('socket', 'epoxy');
  if (options.tlsCheck) location.searchParams.set('tlsCheck', '1');
  const sandbox = {
    URL, navigator: { serviceWorker: { controller: Object.freeze({ type: 'actual-worker-object' }) } }, location,
    document: { getElementById: id => elements.get(id), createElement: name => {
      assert.equal(name, 'script'); return {};
    }, head: { append(script) {
      scripts.push(script);
      queueMicrotask(() => {
        if (options.scriptError) script.onerror();
        else { sandbox.LibcurlTransport = { LibcurlClient: Curl }; script.onload(); }
      });
    } } },
    TR_OS: { async ensureServiceWorker() {}, wispUrl: () => 'wss://tr-os.test/wisp-vps/', withTimeout: promise => promise },
    TR_OS_SNAP_WORKER: { install: target => bridgeInstalls.push(target) },
    $scramjetController: controller, EpoxyTransport: { default: Epoxy },
    console: { info: (...args) => logs.push(args), error: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
    setInterval() { return 1; }, clearInterval() {},
    setTimeout(fn, milliseconds) { timers.set(++nextTimer, { fn, milliseconds }); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
    window: { addEventListener() {} }, parent: { postMessage() {} }
  };
  await vm.runInNewContext(source, sandbox, { filename: 'actual-snapchat.js' });
  if (options.expectFailure) {
    assert.ok(elements.get('message').textContent, 'Startup failure must be shown');
    assert.equal(elements.get('retry').hidden, false);
    assert.equal(configuration, undefined); assert.deepEqual(navigation, []);
  } else {
    assert.equal(elements.get('message').textContent, '', 'Startup should reach the frame rather than catch an error');
    assert.deepEqual(navigation, ['https://web.snapchat.com/']);
  }
  assert.deepEqual(bridgeInstalls, [controller]);
  return { transport: instance, configuration, nativeClient, tuple, logs, connects, requests,
    elements, scripts, curlInstance, curlConnects, curlRequests, curlSends, curlCloses, timers,
    fireTimeout(milliseconds) {
      const match = [...timers].find(([, timer]) => timer.milliseconds === milliseconds);
      assert.ok(match, 'Expected pending timer ' + milliseconds);
      timers.delete(match[0]); match[1].fn();
    } };
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
  assert.equal(h.scripts.length, 0, 'Default flow must not load the optional socket transport');
  assert.equal(h.curlInstance, undefined);
});

test('normal Snapchat entry loads curl sockets and keeps HTTP on initialized Epoxy', async () => {
  const h = await startup(false, { actualDefault: true });
  assert.equal(h.scripts.length, 1);
  assert.equal(h.curlInstance.ready, true);
  h.transport.connect(new URL('wss://chat.example.test/'), [], [], () => {}, () => {}, () => {}, () => {});
  assert.equal(h.curlConnects.length, 1);
  assert.equal(h.connects.length, 0);
  await h.transport.request(new URL('https://http.example.test/'), 'GET', null, []);
  assert.equal(h.requests.length, 1);
  assert.equal(h.curlRequests.length, 0);
});

test('curl sockets preserve original WS URL and auth while HTTP stays on initialized Epoxy', async () => {
  const h = await startup(true, { curl: true });
  assert.equal(h.scripts.length, 1); assert.equal(h.scripts[0].src, '/snap-curl-transport.js');
  assert.equal(h.curlInstance.ready, true);
  assert.equal(h.curlInstance.opts.wisp, h.transport.opts.wisp);
  const target = new URL('wss://chat.example.test:8443/socket?token=URL_QUERY_SECRET');
  const headers = [['Origin', 'https://origin.example.test'], ['Cookie', 'COOKIE_VALUE_SECRET'], ['User-Agent', 'CALLER_UA_SECRET']];
  const protocols = ['PROTOCOL_VALUE_SECRET'], received = [];
  const tuple = h.transport.connect(target, protocols, headers,
    (...args) => received.push(['open', ...args]), (...args) => received.push(['message', ...args]),
    (...args) => received.push(['close', ...args]), (...args) => received.push(['error', ...args]));
  assert.equal(h.connects.length, 0);
  const sent = h.curlConnects[0];
  assert.equal(sent[0], target); assert.equal(sent[0].protocol, 'wss:');
  assert.equal(sent[1], protocols); assert.equal(sent[2], headers);
  assert.equal(h.timers.size, 1);
  sent[3]('SELECTED_PROTOCOL_SECRET', 'EXTENSION_SECRET');
  assert.equal(h.timers.size, 0, 'Open cancels only the handshake timeout');
  sent[4]('MESSAGE_SECRET'); sent[6]('POST_OPEN_ERROR_SECRET'); sent[5](1000, 'CLOSE_REASON_SECRET');
  assert.deepEqual(received, [['open', 'SELECTED_PROTOCOL_SECRET', 'EXTENSION_SECRET'], ['message', 'MESSAGE_SECRET'],
    ['error', 'POST_OPEN_ERROR_SECRET'], ['close', 1000, 'CLOSE_REASON_SECRET']]);
  tuple[0]('OUTGOING_MESSAGE_SECRET'); await tuple[1](1000, 'OUTGOING_CLOSE_SECRET');
  assert.equal(h.curlSends[0], 'OUTGOING_MESSAGE_SECRET'); assert.deepEqual(h.curlCloses[0], [1000, 'OUTGOING_CLOSE_SECRET']);
  const body = 'HTTP_BODY_SECRET';
  await h.transport.request(new URL('https://http.example.test/?token=HTTP_QUERY_SECRET'), 'POST', body, headers);
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0][2], body); assert.equal(h.requests[0][3], headers);
  assert.equal(h.curlRequests.length, 0);
  assert.equal(JSON.stringify(h.logs).includes('SECRET'), false);
  for (const [, metadata] of h.logs) assert.doesNotThrow(() => JSON.parse(metadata));
});

test('curl handshake timeout fails, absorbs asynchronous close rejection and ignores late callbacks', async () => {
  const h = await startup(false, { curl: true, rejectCurlClose: true });
  const received = [];
  h.transport.connect(new URL('wss://chat.example.test/'), [], [],
    () => received.push('open'), () => received.push('data'), () => received.push('close'), error => received.push(['error', error]));
  h.fireTimeout(15000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(received.length, 1); assert.equal(received[0][0], 'error'); assert.match(received[0][1], /timed out/i);
  assert.equal(h.curlCloses.length, 1);
  h.curlConnects[0][3]('', ''); h.curlConnects[0][4]('late data'); h.curlConnects[0][5](1000, 'late close'); h.curlConnects[0][6]('late error');
  assert.equal(received.length, 1, 'Timed-out connections must never report successful open');
  assert.equal(h.timers.size, 0);
});

for (const event of ['close', 'error']) test('curl pre-open ' + event + ' fails the handshake and suppresses late open', async () => {
  const h = await startup(false, { curl: true });
  const received = [];
  h.transport.connect(new URL('wss://chat.example.test/'), [], [],
    () => received.push('open'), () => received.push('data'), () => received.push('close'), error => received.push(['error', error]));
  const sent = h.curlConnects[0];
  if (event === 'close') sent[5](1006, 'controlled premature close'); else sent[6]('controlled premature error');
  assert.equal(received.length, 1); assert.equal(received[0][0], 'error');
  sent[3]('', ''); sent[4]('late data');
  assert.equal(received.length, 1); assert.equal(h.timers.size, 0);
});

for (const failure of ['script', 'init']) test('curl ' + failure + ' failure prevents controller startup', async () => {
  const h = await startup(false, { curl: true, expectFailure: true,
    scriptError: failure === 'script', curlInitError: failure === 'init' ? new Error('controlled curl init failure') : undefined });
  assert.equal(h.configuration, undefined); assert.equal(h.curlConnects.length, 0);
});

test('opt-in TLS check sends only public empty requests and requires bad certificate rejection plus valid HTTPS', async () => {
  const h = await startup(false, { curl: true, tlsCheck: true });
  assert.equal(h.curlRequests.length, 2);
  assert.equal(h.curlRequests[0][0].href, 'https://self-signed.badssl.com/');
  assert.equal(h.curlRequests[1][0].href, 'https://example.com/');
  for (const request of h.curlRequests) {
    assert.equal(request[1], 'GET'); assert.equal(request[2], null); assert.equal(request[3].length, 0);
  }
  assert.equal(h.curlConnects.length, 0);
});

for (const [name, options] of [
  ['untrusted certificate is accepted', { acceptUntrusted: true }],
  ['network error is mistaken for certificate rejection', { badCertificateError: new Error('controlled network timeout') }],
  ['valid HTTPS fails', { validTlsStatus: 503 }]
]) test('TLS verification cannot pass when ' + name, async () => {
  const h = await startup(false, { curl: true, tlsCheck: true, expectFailure: true, ...options });
  assert.equal(h.configuration, undefined); assert.equal(h.curlConnects.length, 0);
  assert.equal(h.logs.some(([label]) => label.includes('untrusted certificate rejected')), false);
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
