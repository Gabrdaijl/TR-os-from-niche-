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
  let memoryVisitorId;
  const presenceListeners = new Set();
  const presence = {
    latest: null,
    publish(data) { this.latest = data; for (const listener of presenceListeners) listener(data); },
    subscribe(listener) { presenceListeners.add(listener); if (this.latest) listener(this.latest); return () => presenceListeners.delete(listener); }
  };
  async function visitorId() {
    const read = () => {
      let id;
      try { id = localStorage.getItem('tros-visitor-id'); } catch (_) {}
      if (!id || !/^[a-f0-9-]{36}$/i.test(id)) {
        id = memoryVisitorId || crypto.randomUUID();
        memoryVisitorId = id;
        try { localStorage.setItem('tros-visitor-id', id); } catch (_) {}
      }
      return id;
    };
    if (navigator.locks) return navigator.locks.request('tros-visitor-id', read);
    return read();
  }
  function identity() {
    try {
      if (window.parent !== window && window.parent.TR_OS) return window.parent.TR_OS.identity();
    } catch (_) {}
    if (!identityPromise) identityPromise = (async function () {
      let token, secret;
      try { token = localStorage.getItem('tros-online-id'); secret = localStorage.getItem('tros-online-secret'); } catch (_) {}
      const response = await nativeFetch(apiUrl('/online'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, secret, visitorId: await visitorId() }), signal: AbortSignal.timeout(10000) });
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
  function watchMembership() {
    if (['/admin.html', '/account.html', '/support.html'].includes(location.pathname)) return;
    let checking = false;
    setInterval(async function () {
      if (checking || document.visibilityState === 'hidden') return;
      checking = true;
      try {
        const response = await nativeFetch(apiUrl('/api/membership/me'), { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(8000) });
        if (!response.ok) return;
        const account = await response.json();
        if (!account.user) location.replace('/account.html?status=login');
        else if (!account.active) location.replace('/account.html?status=expired');
      } catch {} finally { checking = false; }
    }, 30000);
  }
  watchMembership();
  window.TR_OS = Object.freeze({
    apiBase,
    identity,
    visitorId,
    presence,
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

(function () {
 if (window.top !== window) return;
 function credit() {
 const frame=document.getElementById('mainFrame'); if(!frame)return;
 const style=document.createElement('style'); style.textContent='#mainFrame{height:calc(100% - 22px)!important;bottom:22px!important}#creator-credit{position:fixed;bottom:0;right:0;height:22px;display:flex;align-items:center;justify-content:flex-end;padding:0 14px;color:#aeb9c5;background:#0d151f;font:11px system-ui;box-sizing:border-box;z-index:10;pointer-events:none}html:has(:fullscreen) #creator-credit{display:none}';document.head.append(style);
 const el=document.createElement('footer');el.id='creator-credit';el.textContent='skapad av Gr';document.body.append(el);
 function size(){el.style.left=frame.getBoundingClientRect().left+'px';}size();new ResizeObserver(size).observe(frame);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',credit);else credit();
})();
