// Narrow worker support for the separate Scramjet Snapchat controller.
// Uses the owning frame's existing transport and cookies; no new network route.
(function (global) {
  'use strict';
  const installed = new WeakSet();
  const dataScript = text => 'data:text/javascript;charset=utf-8;base64,' +
    btoa(Array.from(new TextEncoder().encode(text), byte => String.fromCharCode(byte)).join(''));

  // Snapchat's own capture scripts may encode a JPEG before the document's
  // load event. Install this before page scripts so a failed or oversized
  // high-quality export can retry at lower quality before upload.
  function installSnapImageEncodingFallback(scope) {
    const marker = '__trosSnapJpegQualityFallback';
    const maxSnapBytes = 8 * 1024 * 1024;
    const needsRetry = blob => !blob || blob.size === 0 || blob.size > maxSnapBytes;
    const isHighQualityJpeg = (type, quality) => typeof type === 'string' &&
      type.split(';', 1)[0].trim().toLowerCase() === 'image/jpeg' &&
      (quality === undefined || (typeof quality === 'number' && quality >= 0.9));
    const retryQualities = quality => [0.85, 0.7, 0.55, 0.4, 0.25].filter(value =>
      typeof quality !== 'number' || value < quality);

    try {
      const prototype = scope.HTMLCanvasElement?.prototype;
      const original = prototype?.toBlob;
      if (typeof original === 'function' && !original[marker]) {
        function toBlob(callback, type, quality) {
          if (typeof callback !== 'function' || !isHighQualityJpeg(type, quality)) {
            return original.apply(this, arguments);
          }
          const levels = retryQualities(quality);
          let index = 0;
          let finished = false;
          const finishOrRetry = blob => {
            if (finished) return;
            if (!needsRetry(blob) || index >= levels.length) {
              finished = true;
              callback(blob);
            } else attempt();
          };
          const attempt = () => {
            const level = levels[index++];
            original.call(this, finishOrRetry, type, level);
          };
          const initialArgs = Array.from(arguments);
          initialArgs[0] = finishOrRetry;
          original.apply(this, initialArgs);
        }
        Object.defineProperty(toBlob, marker, { value: true });
        Object.defineProperty(prototype, 'toBlob', { configurable: true, writable: true, value: toBlob });
      }
    } catch {}

    try {
      const prototype = scope.OffscreenCanvas?.prototype;
      const original = prototype?.convertToBlob;
      if (typeof original === 'function' && !original[marker]) {
        function convertToBlob(options = {}) {
          if (!isHighQualityJpeg(options?.type, options?.quality)) return original.apply(this, arguments);
          const levels = retryQualities(options.quality);
          const attempt = async index => {
            try {
              const attemptOptions = index === 0 ? options : { ...options, quality: levels[index - 1] };
              const blob = await original.call(this, attemptOptions);
              return needsRetry(blob) && index < levels.length ? attempt(index + 1) : blob;
            } catch (error) {
              if (index < levels.length) return attempt(index + 1);
              throw error;
            }
          };
          return attempt(0);
        }
        Object.defineProperty(convertToBlob, marker, { value: true });
        Object.defineProperty(prototype, 'convertToBlob', { configurable: true, writable: true, value: convertToBlob });
      }
    } catch {}
  }

  // Serialized into the proxied window before its Scramjet hooks are installed.
  function windowRelay(key) {
    const scope = globalThis;
    const NativeWorker = scope.Worker;
    if (!NativeWorker || !scope.MessageChannel) return;
    const nativePost = NativeWorker.prototype.postMessage;
    const nativeTerminate = NativeWorker.prototype.terminate;
    const portPost = MessagePort.prototype.postMessage;
    const add = EventTarget.prototype.addEventListener;
    const getData = Object.getOwnPropertyDescriptor(MessageEvent.prototype, 'data').get;
    const stop = Event.prototype.stopImmediatePropagation;
    const workers = new Map();
    const serviceWorker = scope.navigator.serviceWorker;
    const post = (port, data, transfer = []) => portPost.call(port, data, transfer);
    const bodyTransfer = body => body instanceof ArrayBuffer ||
      (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) ? [body] : [];

    function close(state) {
      if (state.closed) return;
      state.closed = true;
      for (const socket of state.sockets.values()) { try { socket.close(); } catch {} }
      state.sockets.clear();
      state.port?.close();
      workers.delete(state.worker);
    }
    function send(state, value, transfer = []) {
      if (!state.closed && state.port) post(state.port, value, transfer);
    }
    async function receive(state, value) {
      if (state.closed || !value || typeof value !== 'object') return;
      const transport = state.client.init.transport;
      const id = value.id;
      try {
        if (value.type === 'request') {
          const response = await transport.request(new URL(value.url), value.method,
            value.body, value.headers, value.cache);
          // Responses are class instances and cannot be reliably structured-
          // cloned across MessagePorts. Send only cloneable fields and rebuild
          // the Scramjet response in the worker that issued the request.
          send(state, { type: 'response', id, url: value.url, value: {
            status: response.status,
            statusText: response.statusText,
            headers: response.rawHeaders || Array.from(response.headers || []),
            body: response.body
          } }, bodyTransfer(response.body));
        } else if (value.type === 'cookies') {
          const entries = value.entries;
          if (!Array.isArray(entries) || entries.some(entry => typeof entry?.url !== 'string' || typeof entry.cookie !== 'string')) {
            throw new Error('Invalid worker cookie update');
          }
          if (value.clear) state.client.context.cookieJar.clear();
          for (const entry of entries) state.client.context.cookieJar.setCookies(entry.cookie, new URL(entry.url));
          await state.client.init.sendSetCookie(entries.map(entry => ({ url: new URL(entry.url), cookie: entry.cookie })), { clear: !!value.clear });
          send(state, { type: 'response', id, value: null });
        } else if (value.type === 'connect') {
          const url = new URL(value.url);
          const cookieUrl = new URL(url.href);
          if (url.protocol === 'wss:') cookieUrl.protocol = 'https:';
          else if (url.protocol === 'ws:') cookieUrl.protocol = 'http:';
          else throw new Error('Worker socket URL must use ws or wss');
          if (!Array.isArray(value.headers) || value.headers.some(header => !Array.isArray(header) || header.length !== 2 ||
              typeof header[0] !== 'string' || typeof header[1] !== 'string')) throw new Error('Invalid worker socket headers');
          // The upstream worker hook snapshots cookies before its async channel
          // opens, and Blob worker URLs are not valid cookie lookup targets.
          // Use the current owner jar for this socket's HTTP(S) destination;
          // never forward a caller Cookie header to another host or downgrade.
          const headers = value.headers.filter(header => header[0].toLowerCase() !== 'cookie');
          let lookupJar = state.client.context.cookieJar;
          if (url.protocol === 'ws:') {
            // The pinned upstream jar does not itself filter Secure by scheme.
            // Filter a serialized copy rather than changing the owner's state.
            const saved = JSON.parse(lookupJar.dump());
            for (const [name, cookie] of Object.entries(saved)) if (cookie.secure) delete saved[name];
            lookupJar = new scope.$scramjet.CookieJar();
            lookupJar.load(JSON.stringify(saved));
          }
          const cookie = lookupJar.getCookies(cookieUrl, false);
          if (cookie) headers.push(['Cookie', cookie]);
          const socket = { send: null, close: null };
          state.sockets.set(id, socket);
          const callbacks = transport.connect(url, value.protocols, headers,
            (protocol, extensions) => send(state, { type: 'socket-open', id, protocol, extensions }),
            data => send(state, { type: 'socket-data', id, data }, bodyTransfer(data)),
            (code, reason) => { state.sockets.delete(id); send(state, { type: 'socket-close', id, code, reason }); },
            error => { state.sockets.delete(id); send(state, { type: 'socket-error', id, error: String(error) }); });
          socket.send = callbacks[0];
          socket.close = callbacks[1];
        } else if (value.type === 'socket-send') {
          state.sockets.get(id)?.send?.(value.data);
        } else if (value.type === 'socket-end') {
          state.sockets.get(id)?.close?.(value.code, value.reason);
        }
      } catch (error) {
        send(state, { type: value.type === 'connect' ? 'socket-error' : 'response', id, error: String(error) });
      }
    }

    scope.Worker = new Proxy(NativeWorker, {
      construct(target, args, newTarget) {
        const worker = Reflect.construct(target, args, newTarget);
        const state = { worker, port: null, client: null, sockets: new Map(), closed: false };
        // Even a Blob worker receives nothing without this frame's marker.
        // This routes an owning frame; it is not worker-code authentication.
        // A raw/unrewritten worker without that marker receives no cookies.
        add.call(worker, 'message', event => {
          const value = getData.call(event);
          if (value?.marker !== key || value.type !== 'tros-worker-ready') return;
          stop.call(event);
          if (state.closed || state.port) return;
          const client = scope[scope.$scramjet.SCRAMJETCLIENT];
          if (!client?.init?.transport || !client.context?.cookieJar) return;
          const channel = new MessageChannel();
          state.port = channel.port1;
          state.client = client;
          workers.set(worker, state);
          add.call(state.port, 'message', event => { void receive(state, event.data); });
          state.port.start();
          nativePost.call(worker, {
            marker: key, port: channel.port2, cookies: client.context.cookieJar.dump()
          }, [channel.port2]);
        }, true);
        add.call(worker, 'error', () => close(state));
        add.call(worker, 'messageerror', () => close(state));
        return worker;
      }
    });
    NativeWorker.prototype.terminate = function () {
      const state = workers.get(this);
      if (state) close(state);
      return nativeTerminate.call(this);
    };
    // Capture the real SW object before the engine hides it from proxied pages.
    if (serviceWorker) add.call(serviceWorker, 'message', event => {
      const update = event.data?.$controller$setCookie;
      if (!update || !Array.isArray(update.cookies)) return;
      for (const state of workers.values()) send(state, {
        type: 'cookie-sync', entries: update.cookies, clear: !!update.options?.clear
      });
    });
    add.call(scope, 'pagehide', () => { for (const state of Array.from(workers.values())) close(state); });
  }

  // Serialized into each proxied worker. It never assumes WorkerNavigator has SW.
  function workerRuntime(settings) {
    const scope = globalThis;
    const core = scope.$scramjet;
    const nativeAdd = EventTarget.prototype.addEventListener;
    const nativePost = MessagePort.prototype.postMessage;
    const workerPost = scope.postMessage;
    const getData = Object.getOwnPropertyDescriptor(MessageEvent.prototype, 'data').get;
    const getPorts = Object.getOwnPropertyDescriptor(MessageEvent.prototype, 'ports').get;
    const stop = Event.prototype.stopImmediatePropagation;
    const cookieJar = new core.CookieJar();
    cookieJar.load(settings.cookies);
    core.setWasm(Uint8Array.from(atob(scope.WASM), char => char.charCodeAt(0)));
    delete scope.WASM;
    let port = null, serial = 0, resolveReady, rejectReady;
    const pending = new Map(), sockets = new Map();
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    // Avoid an unhandled rejection if the application never uses its transport.
    ready.catch(() => {});
    const timer = setTimeout(() => rejectReady(new Error('Worker transport channel was not supplied by its owning frame')), 20000);
    const transfers = body => body instanceof ArrayBuffer ||
      (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) ? [body] : [];
    const send = (value, transfer = []) => nativePost.call(port, value, transfer);
    function applyCookies(entries, clear) {
      if (clear) cookieJar.clear();
      if (!Array.isArray(entries)) return;
      for (const entry of entries) {
        if (typeof entry?.url === 'string' && typeof entry.cookie === 'string') cookieJar.setCookies(entry.cookie, new URL(entry.url));
      }
    }
    function receive(value) {
      if (!value || typeof value !== 'object') return;
      if (value.type === 'response') {
        const request = pending.get(value.id);
        if (!request) return;
        pending.delete(value.id);
        if (value.error) {
          request.reject(new Error(value.error));
          return;
        }
        const response = value.value;
        request.resolve(response && typeof response.status === 'number' &&
          typeof core.BareResponse?.fromTransferrableResponse === 'function'
          ? core.BareResponse.fromTransferrableResponse(response, value.url)
          : response);
      } else if (value.type === 'cookie-sync') {
        applyCookies(value.entries, value.clear);
      } else {
        const socket = sockets.get(value.id);
        if (!socket) return;
        if (value.type === 'socket-open') socket.open(value.protocol, value.extensions);
        if (value.type === 'socket-data') socket.message(value.data);
        if (value.type === 'socket-close') { sockets.delete(value.id); socket.close(value.code, value.reason); }
        if (value.type === 'socket-error') { sockets.delete(value.id); socket.error(value.error); }
      }
    }
    nativeAdd.call(scope, 'message', event => {
      const value = getData.call(event), ports = getPorts.call(event);
      if (value?.marker !== settings.key || ports.length !== 1 ||
          ports[0] !== value.port || !(value.port instanceof MessagePort)) return;
      stop.call(event);
      if (port) { value.port.close(); return; }
      port = value.port;
      cookieJar.load(value.cookies);
      nativeAdd.call(port, 'message', event => receive(event.data));
      port.start();
      clearTimeout(timer);
      resolveReady();
    }, true);
    const transport = {
      ready: false,
      async init() { await ready; this.ready = true; },
      async request(url, method, body, headers, cache) {
        await this.init();
        const id = serial++;
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          try { send({ type: 'request', id, url: url.href, method, body, headers, cache }, transfers(body)); }
          catch (error) { pending.delete(id); reject(error); }
        });
      },
      connect(url, protocols, headers, open, message, close, error) {
        const id = serial++;
        sockets.set(id, { open, message, close, error });
        void this.init().then(() => send({ type: 'connect', id, url: url.href, protocols, headers })).catch(reason => {
          sockets.delete(id); error(String(reason));
        });
        const enqueue = (value, transfer = []) => {
          void this.init().then(() => send(value, transfer)).catch(reason => {
            if (sockets.delete(id)) error(String(reason));
          });
        };
        return [data => enqueue({ type: 'socket-send', id, data }, transfers(data)),
          (code, reason) => enqueue({ type: 'socket-end', id, code, reason })];
      },
      async sendSetCookie(entries, options = {}) {
        await this.init();
        const id = serial++;
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          try { send({ type: 'cookies', id, entries: entries.map(entry => ({ url: entry.url.href, cookie: entry.cookie })), clear: !!options.clear }); }
          catch (error) { pending.delete(id); reject(error); }
        });
      }
    };
    const context = {
      config: settings.config, prefix: new URL(settings.prefix, scope.location.href), cookieJar,
      interface: { codecEncode: settings.codecEncode, codecDecode: settings.codecDecode }
    };
    const client = new core.ScramjetClient(scope, {
      context, transport,
      sendSetCookie: (entries, options) => transport.sendSetCookie(entries, options)
    });
    workerPost.call(scope, { marker: settings.key, type: 'tros-worker-ready' });
    client.hook();
  }

  function install(controller) {
    if (!controller?.Frame?.prototype) throw new Error('Snapchat Scramjet controller is missing');
    if (installed.has(controller)) return;
    const prototype = controller.Frame.prototype;
    const original = Object.getOwnPropertyDescriptor(prototype, 'context');
    if (!original?.get) throw new Error('Unsupported Snapchat controller: frame context getter missing');
    const keys = new WeakMap();
    Object.defineProperty(prototype, 'context', {
      ...original,
      get() {
        const context = original.get.call(this);
        if (!keys.has(this)) keys.set(this, 'tros-snap-worker-' + crypto.randomUUID());
        const key = keys.get(this), frame = this;
        const originalScripts = context.interface.getInjectScripts;
        context.interface.getInjectScripts = function (meta, handler, html, script) {
          const scripts = originalScripts.call(this, meta, handler, html, script);
          if (!Array.isArray(scripts)) throw new Error('Unsupported Snapchat controller script list');
          const relay = script(dataScript('(' + windowRelay.toString() + ')(' + JSON.stringify(key) + ');'));
          const jpegFallback = script(dataScript('(' + installSnapImageEncodingFallback.toString() + ')(globalThis);'));
          // Run our capture recovery and worker relay before the final upstream
          // loader and before Snapchat's own application scripts execute.
          scripts.splice(Math.max(0, scripts.length - 1), 0, jpegFallback, relay);
          return scripts;
        };
        context.interface.getWorkerInjectScripts = function (_meta, _type, script) {
          const settings = '{key:' + JSON.stringify(key) + ',config:' + JSON.stringify(frame.controller.scramjetConfig) +
            ',prefix:' + JSON.stringify(frame.prefix) + ',cookies:' + JSON.stringify(frame.controller.cookieJar.dump()) +
            ',codecEncode:' + frame.controller.config.codec.encode.toString() +
            ',codecDecode:' + frame.controller.config.codec.decode.toString() + '}';
          return script(frame.controller.config.scramjetPath) +
            script(frame.prefix + frame.controller.config.virtualWasmPath) +
            script(dataScript('(' + workerRuntime.toString() + ')(' + settings + ');'));
        };
        return context;
      }
    });
    installed.add(controller);
  }
  global.TR_OS_SNAP_WORKER = Object.freeze({ install });
})(globalThis);
