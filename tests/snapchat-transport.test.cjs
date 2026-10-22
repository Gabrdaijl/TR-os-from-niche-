'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../snapchat.js'), 'utf8');

const release = source.match(/const release = '([^']+)'/)[1];
const lazySource = fs.readFileSync(path.join(__dirname, '../snap-lazy-curl.js'), 'utf8');
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
  if (options.notificationCompat === false) location.searchParams.set('optionalNotifications', '0');
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
    window: { addEventListener() {}, TR_OS_SNAP_REPORT: options.report, TR_OS_SNAP_DIAGNOSTICS: options.observer, TR_OS_SNAP_COMPAT: options.missingCompat ? undefined : {
      release: release, response: value => value, ...options.compat
    } }, parent: { postMessage() {} }
  };
  vm.runInNewContext(lazySource, sandbox);
  sandbox.window.TR_OS_SNAP_CURL.release = release;
  await vm.runInNewContext(source, sandbox, { filename: 'actual-snapchat.js' });
  if (options.expectFailure) {
    assert.ok(elements.get('message').textContent, 'Startup failure must be shown');
    assert.equal(elements.get('retry').hidden, false);
    assert.equal(configuration, undefined); assert.deepEqual(navigation, []);
  } else {
    assert.equal(elements.get('message').textContent, '', 'Startup should reach the frame rather than catch an error');
    assert.deepEqual(navigation, ['https://web.snapchat.com/']);
  }
  assert.deepEqual(bridgeInstalls, options.missingCompat || options.compat?.release === 'old' ? [] : [controller]);
  return { async connect(...args) { const tuple=instance.connect(...args);await new Promise(resolve=>setImmediate(resolve));return tuple; }, transport: instance, configuration, nativeClient, tuple, logs, connects, requests,
    elements, scripts, get curlInstance() { return curlInstance; }, curlConnects, curlRequests, curlSends, curlCloses, timers,
    fireTimeout(milliseconds) {
      const match = [...timers].find(([, timer]) => timer.milliseconds === milliseconds);
      assert.ok(match, 'Expected pending timer ' + milliseconds);
      timers.delete(match[0]); match[1].fn();
    } };
}

test('crash-body inspection requires explicit diagnostics and exact Sentry destination', async () => {
  for (const diagnostics of [false, true]) {
    const inspected = [], body = new Uint8Array([1, 2, 3]);
    const h = await startup(diagnostics, { observer: { observe(value, report) {
      inspected.push(value); report({ type: 'TypeError', frames: [] }); return value;
    } } });
    await h.transport.request(new URL('https://sentry.sc-prod.net/envelope'), 'POST', body, []);
    await h.transport.request(new URL('https://www.snapchat.com/private'), 'POST', body, []);
    await h.transport.request(new URL('https://sentry.sc-prod.net.attacker.invalid/envelope'), 'POST', body, []);
    assert.equal(inspected.length, diagnostics ? 1 : 0);
    assert.ok(h.requests.every(args => args[2] === body));
    assert.equal(h.logs.filter(args => args[0] === 'TR-os Snapchat crash location').length, diagnostics ? 1 : 0);
  }
});
test('an optional report initialization failure cannot prevent Snapchat startup', async () => {
  const h = await startup(false, { actualDefault: true, report: { release: release, create() { throw new Error('PRIVATE_REPORT_ERROR'); } } });
  assert.equal(h.elements.get('message').textContent, '');
  assert.doesNotMatch(JSON.stringify(h.logs), /PRIVATE_REPORT_ERROR/);
});
test('safe report receives compatibility, public script and socket outcomes only in opt-in mode', async () => {
  const events = [];
  const h = await startup(true, { actualDefault: true, report: { release: release, create(enabled, ready, options) {
    assert.equal(enabled, true); assert.equal(ready, true); assert.equal(options.compatibilityEnabled, true); assert.equal(options.socketMode, 'curl');
    return { stage: value => events.push(['stage', value]), compatibility: value => events.push(['compatibility', value]),
      asset: (url, status) => events.push(['asset', url, status]), socket: value => events.push(['socket', value]), crash() {} };
  } }, compat: { response(value, _url, report) { report('applied'); return value; } } });
  await h.transport.request(new URL('https://cf-st.sc-cdn.net/dw/127ca002fe3599f56576.js'), 'GET', null, []);
  await h.connect(new URL('wss://aws.duplex.snapchat.com/'), [], [], () => {}, () => {}, () => {}, () => {});
  h.curlConnects[0][3]('PRIVATE_PROTOCOL');
  assert.ok(events.some(item => item[0] === 'compatibility' && item[1] === 'applied'));
  assert.ok(events.some(item => item[0] === 'socket' && item[1] === 'open'));
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE_PROTOCOL/);
});

test('notification compatibility is enabled normally, has explicit comparison opt-out and never inspects POST', async () => {
  for (const enabled of [false, undefined, true]) {
    const inspected = [];
    const h = await startup(false, { notificationCompat: enabled, compat: { response(value, url) { inspected.push(url.hostname); return value; } } });
    const body = new Uint8Array([9, 8, 7]);
    await h.transport.request(new URL('https://cf-st.sc-cdn.net/dw/fixture.js'), 'GET', null, []);
    await h.transport.request(new URL('https://www.snapchat.com/private'), 'POST', body, []);
    assert.equal(inspected.length, enabled === false ? 0 : 1);
    assert.equal(h.requests[1][2], body);
  }
});

test('missing or mismatched compatibility helper stops before network/controller instead of opening broken app', async () => {
  for (const options of [{ missingCompat: true }, { compat: { release: 'old' } }]) {
    const h = await startup(false, { ...options, actualDefault: true, expectFailure: true });
    assert.equal(h.scripts.length, 0);
    assert.equal(h.transport, undefined);
    assert.match(h.elements.get('message').textContent, /Ladda om TR-os/);
  }
});

test('opt-in startup metadata and compatibility outcomes contain only fixed technical fields', async () => {
  const h = await startup(true, { compat: { response(value, _url, report) { report('applied'); return value; } } });
  await h.transport.request(new URL('https://cf-st.sc-cdn.net/dw/fixture.js?PRIVATE_QUERY'), 'GET', null, []);
  const start = JSON.parse(h.logs.find(([name]) => name === 'TR-os Snapchat startup')[1]);
  assert.deepEqual(start, { release: release, compatibilityEnabled: true, compatibilityReady: true });
  const outcome = JSON.parse(h.logs.find(([name]) => name === 'TR-os Snapchat compatibility')[1]);
  assert.deepEqual(outcome, { release: release, outcome: 'applied' });
  assert.doesNotMatch(JSON.stringify(h.logs), /PRIVATE_QUERY/);
});

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
  assert.equal(await h.connect(target, protocols, headers, ...callbacks), h.tuple);
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
  assert.equal(h.scripts.length, 0, 'Socket WASM stays unloaded until first connection');
  assert.equal(h.curlInstance, undefined);
  await h.connect(new URL('wss://chat.example.test/'), [], [], () => {}, () => {}, () => {}, () => {});
  assert.equal(h.scripts.length, 1);
  assert.equal(h.curlInstance.ready, true);
  assert.equal(h.curlConnects.length, 1);
  assert.equal(h.connects.length, 0);
  await h.transport.request(new URL('https://http.example.test/'), 'GET', null, []);
  assert.equal(h.requests.length, 1);
  assert.equal(h.curlRequests.length, 0);
});

test('Snapchat CDN media PUT uses libcurl while API and asset requests stay on Epoxy', async () => {
  const h = await startup(false, { actualDefault: true });
  const image = new Uint8Array([1, 2, 3]);
  const headers = [['Content-Type', 'image/jpeg']];
  const upload = new URL('https://cf-st.sc-cdn.net/upload/signed-media');

  await h.transport.request(upload, 'PUT', image, headers);

  assert.equal(h.curlRequests.length, 1);
  assert.deepEqual(h.curlRequests[0], [upload, 'PUT', image, headers]);
  assert.equal(h.requests.length, 0, 'The Epoxy HTTP method must not receive the media upload');
  assert.equal(h.scripts.length, 1, 'The alternate transport loads only when a media PUT occurs');

  await h.transport.request(new URL('https://cf-st.sc-cdn.net/dw/fixture.js'), 'GET', null, []);
  await h.transport.request(new URL('https://api.snapchat.com/upload'), 'PUT', image, headers);

  assert.equal(h.requests.length, 2, 'GET assets and other hosts keep the existing Epoxy path');
  assert.equal(h.curlRequests.length, 1, 'Only the exact CDN PUT is routed through libcurl');
});

test('curl sockets preserve original WS URL and auth while HTTP stays on initialized Epoxy', async () => {
  const h = await startup(true, { curl: true });
  assert.equal(h.scripts.length, 0);
  const target = new URL('wss://chat.example.test:8443/socket?token=URL_QUERY_SECRET');
  const headers = [['Origin', 'https://origin.example.test'], ['Cookie', 'COOKIE_VALUE_SECRET'], ['User-Agent', 'CALLER_UA_SECRET']];
  const protocols = ['PROTOCOL_VALUE_SECRET'], received = [];
  const tuple = await h.connect(target, protocols, headers,
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
  assert.throws(()=>tuple[0]('OUTGOING_MESSAGE_SECRET'), /not open/);
  await tuple[1](1000, 'OUTGOING_CLOSE_SECRET');
  assert.equal(h.curlSends.length, 0, 'Application cannot send after a closed socket');
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
  await h.connect(new URL('wss://chat.example.test/'), [], [],
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
  await h.connect(new URL('wss://chat.example.test/'), [], [],
    () => received.push('open'), () => received.push('data'), () => received.push('close'), error => received.push(['error', error]));
  const sent = h.curlConnects[0];
  if (event === 'close') sent[5](1006, 'controlled premature close'); else sent[6]('controlled premature error');
  assert.equal(received.length, 1); assert.equal(received[0][0], 'error');
  sent[3]('', ''); sent[4]('late data');
  assert.equal(received.length, 1); assert.equal(h.timers.size, 0);
});

for (const failure of ['script', 'init']) test('lazy curl ' + failure + ' failure reaches socket error without opening a connection', async () => {
  const h = await startup(false, { curl: true,
    scriptError: failure === 'script', curlInitError: failure === 'init' ? new Error('controlled curl init failure') : undefined });
  const errors=[];
  await h.connect(new URL('wss://chat.example.test/'),[],[],()=>assert.fail('must not open'),()=>{},()=>{},error=>errors.push(error));
  assert.equal(errors.length,1);assert.ok(h.configuration);assert.equal(h.curlConnects.length,0);
});

test('a failed lazy WASM initialization is retried on the next socket attempt and cached after success', async () => {
  const sandbox = { window: {} };
  vm.runInNewContext(lazySource, sandbox);
  const client = Object.freeze({ ready: true });
  let attempts = 0;
  const lazy = sandbox.window.TR_OS_SNAP_CURL.create(async () => {
    attempts++;
    if (attempts === 1) throw new RangeError('Out of memory');
    return client;
  });
  await assert.rejects(lazy.client(), RangeError);
  assert.equal(await lazy.client(), client);
  assert.equal(await lazy.client(), client);
  assert.equal(attempts, 2);
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
    await h.connect(target, protocols, headers, () => {}, () => {}, () => {}, () => {});
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
  const result = await h.connect(target, protocols, headers,
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
