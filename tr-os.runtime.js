(function () {
  'use strict';
  const cfg = window.TR_OS_CONFIG || {};
  const base = new URL('.', document.currentScript.src);
  const apiBase = cfg.apiBase ? new URL(cfg.apiBase, base).href.replace(/\/$/, '') : location.origin;
  const socketBase = new URL(cfg.wispBase || apiBase);
  socketBase.protocol = socketBase.protocol === 'https:' || socketBase.protocol === 'wss:' ? 'wss:' : 'ws:';
  const nativeFetch = window.fetch.bind(window);
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', event => {
    if (event.data && event.data.type === 'tr-os-proxy-error') console.error('TR-os proxy:', event.data.message);
  });
  function withTimeout(promise, milliseconds, message) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      })
    ]).finally(() => clearTimeout(timer));
  }
  let workerReady;
  let identityPromise;
  function identity() {
    try {
      if (window.parent !== window && window.parent.TR_OS) return window.parent.TR_OS.identity();
    } catch (_) {}
    if (!identityPromise) identityPromise = (async function () {
      let token, secret;
      try { token = localStorage.getItem('tros-online-id'); secret = localStorage.getItem('tros-online-secret'); } catch (_) {}
      const response = await nativeFetch(apiUrl('/online'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, secret }), signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('Online service unavailable');
      const data = await response.json();
      if (typeof data.token !== 'string' || typeof data.secret !== 'string') throw new Error('Invalid online session');
      try { localStorage.setItem('tros-online-id', data.token); localStorage.setItem('tros-online-secret', data.secret); } catch (_) {}
      return data;
    })().catch(error => { identityPromise = null; throw error; });
    return identityPromise;
  }
  function ensureServiceWorker() {
    if (!('serviceWorker' in navigator)) return Promise.reject(new Error('This browser does not support the web proxy.'));
    if (!workerReady) {
      workerReady = withTimeout((async function () {
        await navigator.serviceWorker.register(new URL('sw.js', base).href);
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) {
          await new Promise(resolve => {
            const changed = () => {
              if (!navigator.serviceWorker.controller) return;
              navigator.serviceWorker.removeEventListener('controllerchange', changed);
              resolve();
            };
            navigator.serviceWorker.addEventListener('controllerchange', changed);
            changed();
          });
        }
      })(), 12000, 'The web proxy could not start. Please reload and try again.').catch(error => {
        workerReady = null;
        throw error;
      });
    }
    return workerReady;
  }
  function apiUrl(path) { return new URL(String(path).replace(/^\//, ''), apiBase + '/').href; }
  window.TR_OS = Object.freeze({
    apiBase,
    identity,
    vpnConfigured: cfg.vpnConfigured,
    proxyProvider: cfg.proxyProvider,
    cloudKeyOnServer: !!cfg.cloudKeyOnServer,
    cloudConfigured: cfg.cloudConfigured,
    ensureServiceWorker,
    withTimeout,
    aiUrl: new URL(cfg.aiUrl || '/api/ai', apiBase + '/').href,
    apiUrl,
    assetUrl: function (path) { return new URL(path, base).href; },
    wispUrl: function (path) { return new URL(String(path).replace(/^\//, ''), socketBase.href.replace(/\/$/, '') + '/').href; },
    fetch: function (input, options) {
      if (typeof input === 'string' && /^\/?(?:api\/|online(?:\?|$)|chat\/|cloud\/v1\/)/.test(input)) input = apiUrl(input);
      return nativeFetch(input, options);
    }
  });
}());
