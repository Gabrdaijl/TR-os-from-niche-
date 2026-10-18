const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

function harness(options = {}) {
  const elements = new Map(), listeners = new Map(), starts = [], stops = [], forgets = [], windowListeners = new Map();
  for (const id of ['screen', 'remember', 'start-form', 'start', 'stop', 'message', 'password', 'countdown', 'fullscreen', 'setup', 'forget']) {
    elements.set(id, {
      value: '', checked: false, hidden: false, disabled: false, textContent: '',
      addEventListener(type, fn) { listeners.set(id + ':' + type, fn); },
      removeAttribute(name) { delete this[name]; },
      reportValidity() { return true; },
      requestFullscreen() { return Promise.resolve(); }
    });
  }
  const intervals = new Map();
  let nextInterval = 0;
  const sandbox = {
    document: { getElementById: id => elements.get(id) },
    crypto: webcrypto, AbortController, TextDecoder, TextEncoder, URL, btoa, Uint8Array,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    setInterval(fn) { intervals.set(++nextInterval, fn); return nextInterval; },
    clearInterval(id) { intervals.delete(id); },
    confirm() { return true; }, window: { addEventListener(type, fn) { windowListeners.set(type, fn); } },
    async fetch(url, init) {
      if (url.endsWith('/stop')) {
        stops.push(init);
        const result = options.stopResults?.[stops.length - 1];
        if (result instanceof Error) throw result;
        if (typeof result === 'function') return result();
        return result || { ok: true };
      }
      if (url.endsWith('/forget')) { forgets.push(init); return { ok: true, json: async () => ({ ok: true }) }; }
      let resolveRead;
      const stream = {
        signal: init.signal,
        headers: init.headers,
        read: () => new Promise(resolve => { resolveRead = resolve; }),
        send(events) {
          assert.ok(resolveRead, 'the client is waiting for the stream');
          const resolve = resolveRead; resolveRead = null;
          resolve({ done: false, value: new TextEncoder().encode(events.map(event => JSON.stringify(event)).join('\n') + '\n') });
        }
      };
      starts.push(stream);
      if (options.initialResponse) {
        const response = await options.initialResponse(starts.length, stream);
        if (response) return response;
      }
      if (options.startFailure) return { ok: false, status: options.startFailure.status, json: async () => ({ error: options.startFailure.error }) };
      return { ok: true, body: { getReader: () => stream } };
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../snapchat-test.js'), 'utf8'), sandbox);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  return {
    elements, starts, stops, forgets, intervals, flush, windowListeners,
    async start(password = 'test-only-password') {
      elements.get('password').value = password;
      listeners.get('start-form:submit')({ preventDefault() {} });
      await flush();
      return starts.at(-1);
    },
    stop() { return elements.get('stop').onclick(); },
    forget(password) { elements.get('password').value = password; return elements.get('forget').onclick(); }
  };
}

function ready(name) {
  return { type: 'ready', url: 'https://www.browserbase.com/' + name, expiresAt: new Date(Date.now() + 60000).toISOString() };
}

for (const staleEvent of [ready('old-session'), { type: 'ended', message: 'Old session ended.' }]) {
  test('late ' + staleEvent.type + ' from a stopped stream cannot change or stop the new session', async () => {
    const h = harness();
    const old = await h.start();
    const stopped = h.stop();
    assert.equal(old.signal.aborted, true);
    assert.equal(h.stops.length, 1);
    await stopped;
    const current = await h.start();
    current.send([ready('current-session')]); await h.flush();
    assert.equal(h.elements.get('screen').src, ready('current-session').url);
    assert.equal(h.intervals.size, 1);

    old.send([staleEvent]); await h.flush();
    assert.equal(h.elements.get('screen').src, ready('current-session').url);
    assert.equal(h.elements.get('screen').hidden, false);
    assert.equal(h.elements.get('setup').hidden, true);
    assert.equal(current.signal.aborted, false);
    assert.equal(h.stops.length, 1);
    assert.equal(h.intervals.size, 1);
    await h.stop();
  });
}

test('an ended event prevents a later ready in the same JSONL chunk from reopening the screen', async () => {
  const h = harness(), stream = await h.start();
  stream.send([ready('current-session'), { type: 'ended', message: 'Test completed.' }, ready('late-session')]);
  await h.flush();
  assert.equal(stream.signal.aborted, true);
  assert.equal(h.elements.get('screen').src, undefined);
  assert.equal(h.elements.get('screen').hidden, true);
  assert.equal(h.elements.get('setup').hidden, false);
  assert.equal(h.elements.get('message').textContent, 'Test completed.');
  assert.equal(h.stops.length, 1);
  assert.equal(h.intervals.size, 0);
});

test('stop is idempotent, hides the view immediately and retries HTTP failure once before enabling Start', async () => {
  let resolveRetry;
  const h = harness({ stopResults: [{ ok: false }, () => new Promise(resolve => { resolveRetry = resolve; })] });
  const stream = await h.start();
  stream.send([ready('current-session')]); await h.flush();
  const stopped = h.stop();
  assert.strictEqual(h.stop(), stopped);
  assert.equal(stream.signal.aborted, true);
  assert.equal(h.elements.get('screen').hidden, true);
  assert.equal(h.elements.get('screen').src, undefined);
  assert.equal(h.elements.get('start').disabled, true);
  await h.flush();
  assert.equal(h.stops.length, 2);
  assert.equal(h.stops[0].keepalive, true);
  assert.deepEqual(h.stops[0].headers, h.stops[1].headers);
  await h.start();
  assert.equal(h.starts.length, 1, 'a programmatic submit cannot bypass pending release');
  resolveRetry({ ok: true });
  assert.equal(await stopped, true);
  assert.equal(h.elements.get('start').disabled, false);
  assert.equal(h.elements.get('message').textContent, 'Testet är avslutat.');
});

test('two failed stop attempts report the hard deadline without exposing error details', async () => {
  const secret = 'sensitive-upstream-detail';
  const h = harness({ stopResults: [new Error(secret), { ok: false }] });
  await h.start();
  assert.equal(await h.stop(), false);
  assert.equal(h.stops.length, 2);
  assert.equal(h.elements.get('start').disabled, false);
  assert.equal(h.elements.get('screen').hidden, true);
  assert.equal(h.elements.get('message').textContent, 'Testvyn är stängd. Sessionen kunde inte stängas direkt och avslutas senast efter fyra minuter.');
  assert.equal(h.elements.get('message').textContent.includes(secret), false);
  assert.equal(h.elements.get('password').value, '');
});

test('successful stop is not retried and cannot later change the next session status', async () => {
  const h = harness();
  await h.start();
  assert.equal(await h.stop(), true);
  assert.equal(h.stops.length, 1);
  const current = await h.start();
  current.send([ready('next-session')]); await h.flush();
  assert.equal(h.elements.get('screen').src, ready('next-session').url);
  assert.equal(h.elements.get('start').disabled, true);
  assert.equal(current.signal.aborted, false);
  assert.match(h.elements.get('message').textContent, /Logga in direkt/);
  await h.stop();
});

test('pagehide sends its first keepalive stop before returning and aborts the stream', async () => {
  const h = harness(), current = await h.start();
  h.windowListeners.get('pagehide')();
  assert.equal(h.stops.length, 1);
  assert.equal(h.stops[0].keepalive, true);
  assert.equal(current.signal.aborted, true);
  await h.flush();
});

test('start and forget encode non-Latin-1 admin passwords as UTF-8 Basic auth', async () => {
  const h = harness(), password = 'test-only-🔐-å-日本';
  const current = await h.start(password);
  assert.equal(Buffer.from(current.headers.authorization.slice(6), 'base64').toString('utf8'), 'admin:' + password);
  assert.equal(h.elements.get('password').value, '');
  assert.equal(await h.stop(), true);
  await h.forget(password);
  assert.equal(h.forgets.length, 1);
  assert.equal(Buffer.from(h.forgets[0].headers.authorization.slice(6), 'base64').toString('utf8'), 'admin:' + password);
  assert.equal(h.elements.get('password').value, '');
  assert.equal(h.elements.get('start').disabled, false);
});

test('rejected admin authentication keeps its useful error and does not try stopping a nonexistent session', async () => {
  const h = harness({ startFailure: { status: 401, error: 'Fel lösenord eller utloggad.' } });
  await h.start();
  assert.equal(h.stops.length, 0);
  assert.equal(h.elements.get('message').textContent, 'Fel lösenord eller utloggad.');
  assert.equal(h.elements.get('start').disabled, false);
});

test('a late rejected initial request cannot clear the next session stop credentials', async () => {
  let rejectOld;
  const h = harness({ initialResponse: count => count === 1 ? new Promise(resolve => { rejectOld = resolve; }) : null });
  const old = await h.start('old-test-password');
  assert.equal(await h.stop(), true);
  const current = await h.start('new-test-password');
  current.send([ready('current-session')]); await h.flush();
  rejectOld({ ok: false, status: 401, json: async () => ({ error: 'Old login failed.' }) });
  await h.flush();
  assert.equal(old.signal.aborted, true);
  assert.equal(current.signal.aborted, false);
  assert.equal(h.elements.get('screen').src, ready('current-session').url);
  assert.match(h.elements.get('message').textContent, /Logga in direkt/);
  assert.equal(await h.stop(), true);
  assert.equal(h.stops.length, 2);
  assert.equal(h.stops[1].headers.authorization, current.headers.authorization);
  assert.equal(h.stops[1].headers['x-tros-snap-stop'], current.headers['x-tros-snap-stop']);
  assert.notEqual(h.stops[1].headers['x-tros-snap-stop'], old.headers['x-tros-snap-stop']);
});
