(() => {
  const WISP_ROUTES = {
    vps: "/wisp-vps/",
    "mullvad-us": "/wisp-mullvad-us/",
    "mullvad-eu": "/wisp-mullvad-eu/",
    "mullvad-se": "/wisp-mullvad-se/",
    mullvad: "/wisp-mullvad/"
  };
  let __sj = null, __sjReady = false, __sjInitPromise = null;
  const __proxyScripts = new Map();
  var MV_BUILD = 'r5';
  function mvLog(m) {
    try { window.TR_OS.fetch('api/mullvad/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ m: String(m).slice(0, 200) }) }); } catch (e) {}
  }
  mvLog('boot ' + MV_BUILD);
  try {
    window.addEventListener('error', function (ev) {
      try { mvLog('onerror: ' + String((ev && ev.message) || (ev && ev.error) || ev).slice(0, 200)); } catch (e9) {}
    });
  } catch (ea) {}
  const framesWrap = document.getElementById('frames-wrap');
  const LOCK_CLOSED = '<svg xmlns="http://www.w3.org/2000/svg" width="3.5" height="3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
  const LOCK_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" width="3.5" height="3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>';
  function setLock(secure) {
    const el = document.getElementById('lock-icon');
    if (!el) return;
    el.innerHTML = secure ? LOCK_CLOSED : LOCK_OPEN;
    el.style.color = secure ? '#15803d' : '#dc2626';
  }
  function lockFor(url) {
    let proxied = false;
    try { proxied = typeof url === 'string' && url !== HOME && /^https?:\/\//i.test(url); } catch {}
    setLock(proxied);
  }
  var TROS_HOME_URL = 'tr-os://browser';
  function displayUrl(u) {
    if (!u || u === HOME) return TROS_HOME_URL;
    try {
      var uu = new URL(u, location.href);
      if (uu.origin === location.origin && uu.pathname.replace(/\/+$/, '').endsWith('n1chtesting1.html')) {
        return TROS_HOME_URL;
      }
    } catch (e) {}
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(u)) return u;
    return 'https://' + u;
  }
  let __bareConn = null;
  async function applyTransport() {
    if (!__bareConn) return false;
    try {
      await __bareConn.setTransport(window.TR_OS.assetUrl("epoxy/index.mjs"), [{ wisp: window.TR_OS.wispUrl(wispRoute()) }]);
      return true;
    } catch (err) {
      try {
        await __bareConn.setTransport(window.TR_OS.assetUrl("epoxy/index.mjs"), [{ wisp: window.TR_OS.wispUrl(wispRoute()) }]);
        return true;
      } catch (e2) { return false; }
    }
  }
  const input = document.getElementById('browser-input');
  const tabStrip = document.getElementById('tab-strip');
  const HOME = 'n1chtesting1.html';
  const SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-modals';

  var RESI_ALIAS = { paloalto: 'mullvad-us', boston: 'mullvad-us', milan: 'mullvad-eu' };
  var MV_LOCS = ['mullvad-us', 'mullvad-eu', 'mullvad-se'];
  var RELAY_RE = /^[a-z]{2}-[a-z]{2,4}-wg-[0-9]+\.conf$/;
  var MV_STATUS = null;
  var MV_EXIT_STATE = null;
  function mvEnabled() {
    if (window.TR_OS.vpnConfigured === false) return false;
    try { return localStorage.getItem('tros-mullvad') !== '0'; } catch (er) { return true; }
  }
  function setMvEnabled(on) {
    try { localStorage.setItem('tros-mullvad', on ? '1' : '0'); } catch (er) {}
  }
  function mvExitText() {
    try {
      if (MV_STATUS && (MV_STATUS.city || MV_STATUS.country)) {
        return (MV_STATUS.city ? MV_STATUS.city + ', ' : '') + (MV_STATUS.country || 'Mullvad');
      }
    } catch (e) {}
    return 'Mullvad';
  }
  function syncMvUI() {
    var btn = document.getElementById('mullvad-toggle');
    if (!btn) return;
    btn.disabled = window.TR_OS.vpnConfigured === false;
    var on = mvEnabled();
    btn.textContent = on ? 'MV ON' : 'MV OFF';
    btn.style.opacity = on ? '1' : '0.55';
    var pt0 = document.getElementById('mv-panel-toggle');
    if (pt0) { pt0.checked = on; pt0.disabled = window.TR_OS.vpnConfigured === false; }
    mvSyncPanelLine();
    var eff = 'vps';
    try { eff = localStorage.getItem('tros-loc') || 'mullvad-eu'; } catch (e2) {}
    if (!on || !WISP_ROUTES[eff]) { eff = 'vps'; }
    if (on && MV_STATUS && (MV_STATUS.city || MV_STATUS.country)) {
      btn.title = 'Mullvad ON - ' + mvExitText() + ' - shared exit';
    } else {
      btn.title = on ? 'Mullvad routing ON' : 'Mullvad routing OFF - direct via VPS';
    }
    var ex = document.getElementById('mv-exit');
    if (ex) {
      var route = '';
      try { route = wispRoute(); } catch (e9) {}
      if (route === WISP_ROUTES.vps) {
        ex.textContent = 'Direct proxy';
        ex.title = 'Proxy connection without the Mullvad tunnel';
      } else if (MV_EXIT_STATE !== 'vpn') {
        ex.textContent = MV_EXIT_STATE === 'direct' ? 'VPN verification failed' : 'Checking VPN…';
        ex.title = 'The VPN exit has not been verified through the active proxy';
      } else if (on && MV_STATUS && (MV_STATUS.city || MV_STATUS.country || MV_STATUS.relay)) {
        ex.textContent = mvExitText();
        ex.title = 'Live proxy exit via Mullvad';
      } else if (!on) {
        ex.textContent = 'VPS direct';
        ex.title = 'Mullvad is OFF - traffic exits via VPS (server IP)';
      } else {
        ex.textContent = '...';
        ex.title = 'Live proxy exit';
      }
    }
  }
  function wispRoute() {
    let loc = 'vps';
    try { loc = localStorage.getItem('tros-loc') || 'mullvad-eu'; } catch {}
    if (RESI_ALIAS[loc]) { loc = RESI_ALIAS[loc]; try { localStorage.setItem('tros-loc', loc); } catch (e) {} }
    if (!mvEnabled()) { return WISP_ROUTES.vps; }
    if (loc === 'vps') { return WISP_ROUTES.vps; }
    if (RELAY_RE.test(loc)) { return WISP_ROUTES.mullvad; }
    if (WISP_ROUTES[loc]) { return WISP_ROUTES[loc]; }
    return WISP_ROUTES.mullvad;
  }

  async function initScramjet() {
    if (__sjReady) return true;
    if (__sjInitPromise) return __sjInitPromise;
    if (pendingNav) {
      const status = document.getElementById('browser-status');
      const retry = document.getElementById('browser-retry');
      if (status) {
        status.querySelector('span').textContent = 'Startar webbproxyn…';
        status.hidden = false;
      }
      if (retry) retry.hidden = true;
    }
    __sjInitPromise = (async () => {
      try {
        const loadScript = src => {
          if (__proxyScripts.has(src)) return __proxyScripts.get(src);
          const promise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = () => reject(new Error('A browser component could not be loaded.'));
            document.head.append(script);
          });
          __proxyScripts.set(src, promise);
          promise.catch(() => __proxyScripts.delete(src));
          return promise;
        };
        // Keep proxy code, its WASM rewriter, and Epoxy out of the mobile
        // startup path. The local TR-os home page does not need them.
        await loadScript(window.TR_OS.assetUrl('baremux/index.js'));
        await loadScript(window.TR_OS.assetUrl('scram/scramjet.all.js'));
        const epoxyWarm = import('epoxy/index.mjs').catch(() => null);
        const { ScramjetController } = $scramjetLoadController();
        const client = new ScramjetController({
          files: {
            wasm: window.TR_OS.assetUrl('scram/scramjet.wasm.wasm'),
            all: window.TR_OS.assetUrl('scram/scramjet.all.js'),
            sync: window.TR_OS.assetUrl('scram/scramjet.sync.js'),
          },
        });
        await client.init();
        await window.TR_OS.ensureServiceWorker();
        const conn = new BareMux.BareMuxConnection(window.TR_OS.assetUrl('baremux/worker.js'));
        __bareConn = conn;
        await epoxyWarm;
        try {
          await conn.setTransport(window.TR_OS.assetUrl('epoxy/index.mjs'), [{ wisp: window.TR_OS.wispUrl(wispRoute()) }]);
        } catch {
          try {
            await conn.setTransport(window.TR_OS.assetUrl('epoxy/index.mjs'), [{ wisp: window.TR_OS.wispUrl(wispRoute()) }]);
          } catch {}
        }
        __sj = client;
        __sjReady = true;
        const status = document.getElementById('browser-status');
        if (status) status.hidden = true;
        if (pendingNav) {
          const next = pendingNav;
          pendingNav = null;
          navigate(next);
        }
        return true;
      } catch {
        __sjInitPromise = null;
        if (pendingNav) {
          pendingNav = null;
          const status = document.getElementById('browser-status');
          const retry = document.getElementById('browser-retry');
          if (status) {
            status.querySelector('span').textContent = 'Webbläsarens proxy kunde inte starta på den här enheten. Stäng andra flikar och försök igen.';
            status.hidden = false;
          }
          if (retry) retry.hidden = false;
        }
        return false;
      }
    })();
    return __sjInitPromise;
  }

  function buildUrl(raw) {
    raw = raw.trim();
    try {
      const candidate = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw);
      if (/^(?:www\.)?google\.(?:com|se|co\.uk|de|fr|es|it|nl|ca|com\.au)$/.test(candidate.hostname) && candidate.pathname === '/') {
        return candidate.searchParams.has('q') ? 'https://duckduckgo.com/?q=' + encodeURIComponent(candidate.searchParams.get('q')) : 'https://duckduckgo.com/';
      }
      if (/^(?:www\.)?google\.(?:com|se|co\.uk|de|fr|es|it|nl|ca|com\.au)$/.test(candidate.hostname) && candidate.pathname === '/search' && candidate.searchParams.has('q')) {
        return 'https://duckduckgo.com/?q=' + encodeURIComponent(candidate.searchParams.get('q'));
      }
    } catch {}
    if (/^https?:\/\//i.test(raw)) return raw;
    if (/\.\w{2,}/.test(raw) && !raw.includes(" ")) return "https://" + raw;
    return "https://duckduckgo.com/?q=" + encodeURIComponent(raw);
  }

  let tabs = [];
  let activeId = null;
  const uid = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function activeTab() {
    return tabs.find(t => t.id === activeId) || null;
  }

  function tabLabel(tab) {
    try {
      const u = new URL(tab.lastUrl || HOME, location.href);
      if (u.pathname.endsWith('n1chtesting1.html') || tab.lastUrl === HOME) return 'Home';
      return u.hostname.replace(/^www\./, '') || 'New tab';
    } catch { return 'New tab'; }
  }

  function renderTabs() {
    tabStrip.innerHTML = '';
    tabs.forEach(tab => {
      const b = document.createElement('button');
      const on = tab.id === activeId;
      b.className = 'font-sans max-w-[160px] shrink-0 h-8 px-2 mb-1 rounded-xl text-xs truncate flex items-center gap-1.5 cursor-pointer transition whitespace-nowrap ' +
        (on ? '' : 'bg-blue-400 text-blue-50 hover:bg-blue-500');
      const label = document.createElement('span');
      label.className = 'truncate';
      label.textContent = tabLabel(tab);
      b.appendChild(label);
      if (tab.favicon) {
        const im = document.createElement('img');
        im.className = 'shrink-0 rounded';
        im.style.cssText = 'width:16px;height:16px;';
        im.src = tab.favicon;
        im.onerror = () => { tab.failedIcon = im.src; tab.favicon = null; renderTabs(); };
        b.insertBefore(im, label);
      } else {
        const lt = document.createElement('span');
        lt.className = 'shrink-0 rounded flex items-center justify-center font-bold';
        lt.style.cssText = 'width:16px;height:16px;font-size:10px;background:rgba(10,79,152,.25);';
        lt.textContent = (tabLabel(tab)[0] || '•').toUpperCase();
        b.insertBefore(lt, label);
      }
      const x = document.createElement('span');
      x.className = 'shrink-0 opacity-70 hover:opacity-100 font-bold';
      x.textContent = '×';
      x.addEventListener('click', (e) => { e.stopPropagation(); closeTab(tab.id); });
      b.appendChild(x);
      if (on) {
        b.setAttribute('aria-selected', 'true');
        try {
          const hi = NTAB_HI[ntabTheme()] || NTAB_HI.dark;
          b.style.background = hi.bg;
          b.style.color = hi.fg;
          b.style.fontWeight = '700';
        } catch (e) {}
      } else {
        b.setAttribute('aria-selected', 'false');
      }
      b.addEventListener('click', () => activate(tab.id));
      tabStrip.appendChild(b);
    });
  }

  function newTab(url) {
    const id = uid();
    const f = document.createElement('iframe');
    f.className = 'absolute inset-0 w-full h-full border-0';
    f.setAttribute('sandbox', SANDBOX);
    f.src = url || HOME;
    f.style.display = 'none';
    framesWrap.appendChild(f);
    const tab = { id, frame: f, lastUrl: url || HOME };
    tabs.push(tab);
    f.addEventListener('load', () => onFrameLoad(tab, true));
    activate(id);
    try {
      const btns = tabStrip.children;
      const nb = btns[btns.length - 1];
      if (nb && nb.animate) {
        nb.animate(
          [{ opacity: 0, transform: 'translateY(10px) scale(.94)' }, { opacity: 1, transform: 'none' }],
          { duration: 250, easing: 'cubic-bezier(.22,.61,.36,1)' }
        );
      }
    } catch (e) {}
    return tab;
  }

  function activate(id) {
    const prev = activeTab();
    const prevId = prev ? prev.id : null;
    activeId = id;
    tabs.forEach(t => {
      const f = t.frame;
      if (t.id === id) {
        try { clearTimeout(f._leaveT); } catch (e) {}
        f.classList.remove('tab-leave');
        f.style.display = 'block';
        f.classList.remove('tab-enter');
        void f.offsetWidth;
        f.classList.add('tab-enter');
      } else if (t.id === prevId) {
        f.classList.remove('tab-enter');
        f.classList.add('tab-leave');
        try { clearTimeout(f._leaveT); } catch (e2) {}
        f._leaveT = setTimeout(() => { if (t.id !== activeId) f.style.display = 'none'; }, 170);
      } else {
        f.style.display = 'none';
      }
    });
    renderTabs();
    syncAddress();
  }

  async function closeTab(id) {
    let i = tabs.findIndex(t => t.id === id);
    if (i < 0) return;
    let oldLeft = [];
    try {
      oldLeft = [...tabStrip.children].map(b => b.getBoundingClientRect().left);
    } catch (e9) {}
    try {
      const fr = tabs[i].frame;
      fr.classList.remove('tab-enter');
      fr.classList.remove('tab-leave');
      void fr.offsetWidth;
      fr.classList.add('tab-close');
    } catch (e0) {}
    try {
      const btn = tabStrip.children[i];
      if (btn && btn.animate) {
        const a = btn.animate(
          [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(6px) scale(.92)' }],
          { duration: 160, easing: 'ease-in', fill: 'forwards' }
        );
        const done = (a.finished && a.finished.catch) ? a.finished.catch(() => {}) : Promise.resolve();
        await Promise.race([done, new Promise(r => setTimeout(r, 220))]);
      }
    } catch (e) {}
    i = tabs.findIndex(t => t.id === id);
    if (i < 0) return;
    const [gone] = tabs.splice(i, 1);
    try { clearTimeout(gone.frame._leaveT); } catch (e8) {}
    try { gone.frame.remove(); } catch {}
    if (!tabs.length) { newTab(HOME); return; }
    if (id === activeId) activate(tabs[Math.min(i, tabs.length - 1)].id);
    else renderTabs();
    try {
      const news = [...tabStrip.children];
      news.forEach((nb, j) => {
        const oldJ = j >= i ? j + 1 : j;
        const dx = (oldLeft[oldJ] || 0) - nb.getBoundingClientRect().left;
        if (dx && nb.animate) {
          nb.animate(
            [{ transform: 'translateX(' + dx + 'px)' }, { transform: 'translateX(0)' }],
            { duration: 240, easing: 'cubic-bezier(.22,.61,.36,1)' }
          );
        }
      });
    } catch (e1) {}
  }

  let pendingNav = null;

  function containsAdultSearch(value) {
    try { return !!window.TR_OS_ADULT_SEARCH?.detects(value); }
    catch { return false; }
  }

  function flagAdultSearch() {
    try {
      const moderation = window.top.TR_OS_MODERATION;
      if (moderation?.flagAdultSearch) {
        moderation.flagAdultSearch().catch(() => window.top.alert('Sökningen stoppades, men spärren kunde inte sparas. Försök igen senare.'));
        return;
      }
    } catch {}
    fetch('/api/moderation/flag', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'content-type': 'application/json' }, body: '{}'
    }).then(async response => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.banned) throw new Error('Moderation could not save the ban');
      window.top.postMessage({ type: 'tr-os-moderation-banned' }, location.origin);
    }).catch(() => {
      try { window.top.alert('Sökningen stoppades, men spärren kunde inte sparas. Försök igen senare.'); } catch {}
    });
  }

  function navigate(raw) {
    const tab = activeTab();
    if (!tab || !raw || !raw.trim()) return;
    if (containsAdultSearch(raw)) {
      pendingNav = null;
      try { clearTimeout(suggestTimer); closeSuggest(); } catch {}
      flagAdultSearch();
      return;
    }
    if (/^tr-os:\/\//i.test(raw.trim())) {
      pendingNav = null;
      lockFor(HOME);
      tab.frame.src = HOME;
      tab.lastUrl = HOME;
      renderTabs();
      syncAddress(true);
      return;
    }
    if (!__sjReady) {
      pendingNav = raw;
      try {
        tab.lastUrl = buildUrl(raw);
        renderTabs();
        syncAddress(true);
      } catch {}
      initScramjet();
      return;
    }
    try {
      const url = buildUrl(raw);
      lockFor(url);
      tab.lastUrl = url;
      try { recordHistory(tabLabel(tab), url); } catch (e2) {}
      renderTabs();
      syncAddress(true);
      tab.navigating = true;
      tab.frame.src = __sj.encodeUrl(url);
    } catch (e) {}
  }
  window.trosBrowserNavigate = function (raw) { navigate(raw); };
  window.trosOpenSnapchat = function () {
    const tab = activeTab();
    if (!tab) return;
    tab.lastUrl = 'https://web.snapchat.com/';
    tab.favicon = new URL('snapchat.svg', location.href).href;
    tab.frame.setAttribute('allow', "camera 'self'; microphone 'self'; autoplay 'self'; fullscreen 'self'; clipboard-write 'self'");
    tab.frame.src = 'snapchat.html?v=20261019.4';
    renderTabs();
    syncAddress(true);
  };
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.data?.type !== 'tros-snapchat-location') return;
    const tab = tabs.find(item => item.frame.contentWindow === event.source);
    if (!tab) return;
    try {
      const url = new URL(event.data.url);
      if (!/^https:$/.test(url.protocol) || !/(^|\.)snapchat\.com$/i.test(url.hostname)) return;
      tab.lastUrl = url.href;
      tab.favicon = new URL('snapchat.svg', location.href).href;
      if (tab.id === activeId) syncAddress();
      renderTabs();
    } catch {}
  });

  function syncAddress(force = false) {
    const tab = activeTab();
    if (!tab || (!force && document.activeElement === input)) return;
    try {
      const u = tab.lastUrl || '';
      input.value = displayUrl(u);
      lockFor(u || HOME);
    } catch {}
  }

  function onFrameLoad(tab, loaded = false) {
    try {
      if (loaded) tab.navigating = false;
      if (tab.navigating) return;
      if (!__sj || !__sjReady || typeof __sj.decodeUrl !== "function") return;
      let href = "";
      try { href = tab.frame.contentWindow.location.href; } catch {}
      if (!href || href === "about:blank") href = tab.frame.getAttribute("src") || tab.frame.src;
      if (!href || href === "about:blank") return;
      let decoded = null;
      const actual = new URL(href, location.href);
      if (actual.origin === location.origin && actual.pathname.endsWith('/snapchat.html')) return;
      const homeUrl = new URL(HOME, location.href);
      if (actual.origin === homeUrl.origin && actual.pathname === homeUrl.pathname) {
        const changed = tab.lastUrl !== HOME || !!tab.favicon;
        tab.lastUrl = HOME;
        tab.favicon = null;
        if (tab.id === activeId) syncAddress();
        if (changed) renderTabs();
        return;
      }
      try { decoded = __sj.decodeUrl(href); } catch (e) { decoded = null; }
      if (!decoded || !/^https?:\/\//i.test(decoded)) {
        try {
          const abs = new URL(href, location.href).href;
          if (/^https?:\/\//i.test(abs)) decoded = abs;
          else return;
        } catch (e2) { return; }
      }
      // Proxied pages are same-origin documents, so install the popup blocker
      // after navigation and before the user can interact with the page.
      // Local TR-os pages are left alone; some provide their own in-app flows.
      try {
        if (new URL(decoded).origin !== location.origin) {
          const doc = tab.frame.contentWindow.document;
          if (doc?.documentElement && doc.documentElement.dataset.trOsPopupGuard !== '1') {
            doc.documentElement.dataset.trOsPopupGuard = '1';
            const blocker = doc.createElement('script');
            blocker.src = new URL('/frame-controls.js?v=20261020.4', location.origin).href;
            blocker.async = false;
            (doc.head || doc.documentElement).appendChild(blocker);
          }
        }
      } catch {}
      const previousUrl = tab.lastUrl;
      const previousIcon = tab.favicon;
      tab.lastUrl = decoded;
      lockFor(decoded);
      try {
        const doc = tab.frame.contentWindow.document;
        const link = doc && doc.querySelector('link[rel*="icon"]');
        const iconHref = link && (link.href || link.getAttribute('href'));
        const host = new URL(decoded).hostname;
        const candidate = /(^|\.)snapchat\.com$/i.test(host) ? new URL('snapchat.svg', location.href).href : iconHref;
        tab.favicon = candidate && candidate !== tab.failedIcon ? candidate : null;
      } catch { tab.favicon = null; }
      if (tab.id === activeId) syncAddress();
      if (previousUrl !== tab.lastUrl || previousIcon !== tab.favicon) renderTabs();
    } catch {}
  }

  // Same-document navigation (pushState/replaceState) does not fire iframe load.
  setInterval(() => tabs.forEach(onFrameLoad), 1000);

  function frameOp(fn) {
    const tab = activeTab();
    if (!tab) return;
    try {
      const w = tab.frame.contentWindow;
      if (w) fn(w);
    } catch (e) {}
  }

  document.getElementById('nav-back').addEventListener('click', () => frameOp(w => { try { w.history.back(); } catch {} }));
  document.getElementById('nav-fwd').addEventListener('click', () => frameOp(w => { try { w.history.forward(); } catch {} }));
  document.getElementById('nav-reload').addEventListener('click', () => {
    const tab = activeTab();
    if (!tab) return;
    try {
      tab.frame.contentWindow.location.reload();
    } catch {
      try { tab.frame.src = tab.frame.src; } catch {}
    }
  });
  document.getElementById('nav-home').addEventListener('click', () => {
    const tab = activeTab();
    if (tab) {
      tab.lastUrl = HOME;
      tab.favicon = null;
      tab.frame.src = HOME;
      renderTabs();
      syncAddress(true);
    }
  });
  const NTAB_HI = {
    dark:      { bg: '#4a4a4a', fg: '#ffffff' },
    halloween: { bg: '#7a3a0e', fg: '#ffe0c2' },
    red:       { bg: '#6e1414', fg: '#ffd7d7' },
    green:     { bg: '#0f3d22', fg: '#d3f9e0' },
    light:     { bg: '#0a4f98', fg: '#ffffff' },
    ocean:     { bg: '#174a6b', fg: '#e8f4fa' }
  };
  function ntabTheme() {
    try {
      if (typeof window.trosGetTheme === 'function') {
        const g = window.trosGetTheme();
        if (NTAB_HI[g]) return g;
      }
      const s = localStorage.getItem('tros-theme');
      if (NTAB_HI[s]) return s;
    } catch (e) {}
    return 'dark';
  }
  if (!window._ntabThemeHook) {
    window._ntabThemeHook = true;
    try {
      window.addEventListener('storage', function (e) {
        if (e && (e.key === 'tros-theme' || e.key === 'tros-dark')) {
          try { renderTabs(); } catch (err) {}
          try { syncMvTheme(); } catch (err2) {}
        }
      });
      window.addEventListener('message', function (e) {
        if (e && e.data && (e.data.trosTheme || e.data.trosThemeName)) {
          try { syncMvTheme(); } catch (err3) {}
          try { renderTabs(); } catch (err4) {}
        }
      });
    } catch (e) {}
  }
  const MV_THEME = {
    dark:      { bg: '#141110', border: '#241f1a', text: '#ece2d4', muted: '#8f8478', hover: '#1e1a15', input: '#0d0b09', accent: '#d8c9b8', soft: 'rgba(216,201,184,.22)' },
    halloween: { bg: '#120c07', border: '#2e2114', text: '#f2dfc2', muted: '#b39370', hover: '#1c130b', input: '#0a0705', accent: '#d99a5f', soft: 'rgba(217,154,95,.22)' },
    red:       { bg: '#150c0a', border: '#332019', text: '#f3e2d8', muted: '#b08d82', hover: '#211210', input: '#0d0807', accent: '#d67f6d', soft: 'rgba(214,127,109,.22)' },
    green:     { bg: '#0c110b', border: '#232b20', text: '#e3e8d8', muted: '#8b957f', hover: '#151a13', input: '#070a07', accent: '#a3b18a', soft: 'rgba(163,177,138,.22)' },
    light:     { bg: '#ffffff', border: '#93c5fd', text: '#0a4f98', muted: '#5b7a99', hover: '#dbeafe', input: '#eff6ff', accent: '#0a4f98', soft: 'rgba(10,79,152,.12)' },
    white:     { bg: '#ffffff', border: '#e3ddd0', text: '#211d16', muted: '#8a8177', hover: '#f4f1ea', input: '#f4f1ea', accent: '#2f5d8a', soft: 'rgba(47,93,138,.12)' },
    ocean:     { bg: '#0a1218', border: '#1e3a4d', text: '#d8ecf5', muted: '#7d95a8', hover: '#10202c', input: '#060b10', accent: '#5aa9e6', soft: 'rgba(90,169,230,.22)' }
  };
  function syncMvTheme() {
    let t = 'dark';
    try { t = ntabTheme(); } catch (e) {}
    const p = MV_THEME[t] || MV_THEME.dark;
    const r = document.documentElement.style;
    r.setProperty('--mv-bg', p.bg);
    r.setProperty('--mv-border', p.border);
    r.setProperty('--mv-text', p.text);
    r.setProperty('--mv-muted', p.muted);
    r.setProperty('--mv-hover', p.hover);
    r.setProperty('--mv-input', p.input);
    r.setProperty('--mv-accent', p.accent);
    r.setProperty('--mv-accent-soft', p.soft);
  }
  try { syncMvTheme(); } catch (e) {}
  const locSel = document.getElementById('browser-loc');
  function syncLocSel() {
    let cur = 'mullvad-eu';
    try { cur = localStorage.getItem('tros-loc') || 'vps'; } catch {}
    if (typeof RESI_ALIAS !== 'undefined' && RESI_ALIAS[cur]) { cur = RESI_ALIAS[cur]; try { localStorage.setItem('tros-loc', cur); } catch (e) {} }
    if (!WISP_ROUTES[cur] && !RELAY_RE.test(cur)) { cur = 'mullvad-eu'; }
    locSel.value = cur;
  }
  function mvFirstRelay() {
    if (MV_STATUS && RELAY_RE.test(MV_STATUS.relay) && Array.from(locSel.options).some(option => option.value === MV_STATUS.relay)) return MV_STATUS.relay;
    for (var i = 0; i < locSel.options.length; i++) {
      if (RELAY_RE.test(locSel.options[i].value)) return locSel.options[i].value;
    }
    return 'mullvad-eu';
  }
  async function mvLoadRelays() {
    var data = null;
    try {
      var rr = await window.TR_OS.fetch('api/mullvad/relays');
      data = await rr.json();
    } catch (e) { mvLog('relays fetch fail'); return false; }
    if (!data || !data.relays || !data.relays.length) return false;
    if (data.active) { MV_STATUS = { relay: data.active, exit_ip: data.exit_ip || null, country: '', city: '' }; }
    try {
      var sr = await window.TR_OS.fetch('api/mullvad/status');
      var st = await sr.json();
      if (st && st.relay) MV_STATUS = st;
    } catch (e2) {}
    var keep = null;
    try { keep = localStorage.getItem('tros-loc'); } catch (e3) {}
    locSel.innerHTML = '';
    var vps = document.createElement('option');
    vps.value = 'vps';
    vps.textContent = 'VPS (direct)';
    locSel.appendChild(vps);
    var groups = {};
    data.relays.forEach(function (rel) {
      var g = groups[rel.country];
      if (!g) { g = document.createElement('optgroup'); g.label = rel.country; groups[rel.country] = g; locSel.appendChild(g); }
      var o = document.createElement('option');
      o.value = rel.id;
      o.textContent = rel.label;
      g.appendChild(o);
    });
    var want = keep;
    var okw = false;
    if (want) {
      for (var k = 0; k < locSel.options.length; k++) { if (locSel.options[k].value === want) { okw = true; break; } }
    }
    if (!okw) {
      want = (data.active && RELAY_RE.test(data.active)) ? data.active : mvFirstRelay();
      try { localStorage.setItem('tros-loc', want); } catch (e4) {}
    }
    locSel.value = want;
    if (want === 'vps') setMvEnabled(false);
    locSel.title = 'Mullvad exit (shared by all users)';
    try { if (RELAY_RE.test(locSel.value)) localStorage.setItem('tros-mvloc', locSel.value); } catch (e5) {}
    syncLocSel();
    syncMvUI();
    return true;
  }
  function mvSleep(ms) {
    return new Promise(function (rs) { setTimeout(rs, ms); });
  }
  async function mvSwitchTo(id) {
    var cur = null;
    try { cur = MV_STATUS && MV_STATUS.relay; } catch (e) {}
    if (cur === id) return true;
    var btn = document.getElementById('mullvad-toggle');
    var cyc = document.getElementById('mullvad-cycle');
    try { locSel.disabled = true; } catch (e2) {}
    try { if (cyc) cyc.disabled = true; } catch (e12) {}
    try { if (btn) btn.disabled = true; } catch (e13) {}
    var ok = false;
    var attempt = 0;
    while (!ok && attempt < 3) {
      attempt++;
      if (btn) { btn.textContent = 'SW ' + attempt + '/3'; }
      try {
        var r = await window.TR_OS.fetch('api/mullvad/switch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id }) });
        var d = await r.json();
        if (d && d.ok) { MV_STATUS = d; ok = true; }
        else if (d && d.error === 'switch in progress') { await mvSleep(5000); }
        else { await mvSleep(2000); }
      } catch (e3) {
        await mvSleep(2000);
      }
    }
    var verified = false;
    if (ok) {
      if (btn) { btn.textContent = '...'; }
      for (var vi = 0; vi < 10; vi++) {
        try {
          var vsr = await window.TR_OS.fetch('api/mullvad/status');
          var vst = await vsr.json();
          if (vst && vst.relay === id) { MV_STATUS = vst; verified = true; break; }
          if (vst && vst.relay) { MV_STATUS = vst; }
        } catch (e8) {}
        await mvSleep(2000);
      }
    }
    try { locSel.disabled = false; } catch (e4) {}
    try { if (cyc) cyc.disabled = false; } catch (e14) {}
    try { if (btn) btn.disabled = false; } catch (e15) {}
    syncMvUI();
    mvLog('switch ' + id + ' ok=' + ok + ' verified=' + verified + ' attempts=' + attempt);
    return verified;
  }
  function mvShowErr(msg) {
    var b2 = document.getElementById('mullvad-toggle');
    if (b2) { b2.textContent = 'ERR'; b2.title = msg || 'Switch failed - try another exit'; }
  }
  function mvRevertSelect() {
    var back = null;
    try { back = MV_STATUS && MV_STATUS.relay; } catch (e10) {}
    var hasBack = false;
    if (back) {
      for (var bi = 0; bi < locSel.options.length; bi++) {
        if (locSel.options[bi].value === back) { hasBack = true; break; }
      }
    }
    if (!hasBack) { back = mvFirstRelay(); }
    locSel.value = back;
    try { localStorage.setItem('tros-loc', back); } catch (e11) {}
    syncLocSel();
    syncMvUI();
  }
  async function mvCheckExit() {
    var ex = document.getElementById('mv-exit');
    if (window.TR_OS.vpnConfigured === false) { MV_EXIT_STATE = 'direct'; syncMvUI(); return; }
    try {
      if (!__sj || !__sjReady || typeof __sj.encodeUrl !== 'function') return;
      if (ex) { ex.title = 'Checking live exit through Scramjet...'; }
      var checkedRoute = wispRoute();
      var url = __sj.encodeUrl('https://am.i.mullvad.net/json');
      var ctl = null;
      try { ctl = new AbortController(); } catch (e) { ctl = null; }
      var to = setTimeout(function () { try { ctl.abort(); } catch (e2) {} }, 15000);
      var r;
      try { r = await window.TR_OS.fetch(url, { signal: ctl ? ctl.signal : undefined, cache: 'no-store' }); }
      finally { clearTimeout(to); }
      if (!r.ok) throw new Error('Exit check unavailable');
      var exit = await r.json();
      if (checkedRoute !== wispRoute()) return;
      MV_EXIT_STATE = exit.mullvad_exit_ip === true ? 'vpn' : 'direct';
      if (checkedRoute !== WISP_ROUTES.vps) {
        try {
          var sr = await window.TR_OS.fetch('api/mullvad/status');
          var st = await sr.json();
          if (st && st.relay) { MV_STATUS = st; }
        } catch (e5) {}
      }
      syncMvUI();
    } catch (e4) { MV_EXIT_STATE = null; syncMvUI(); if (ex) ex.title = 'Exit verification is unavailable. Click to retry.'; }
  }
  async function mvReapply() {
    MV_EXIT_STATE = null;
    try { await applyTransport(); } catch (e5) {}
    try { syncMvUI(); } catch (e6) {}
    try { await mvCheckExit(); } catch (e7) {}
  }
  async function mvHandleSelect() {
    var v = locSel.value;
    mvLog('select ' + v);
    try { localStorage.setItem('tros-loc', v); } catch (e7) {}
    if (RELAY_RE.test(v)) {
      setMvEnabled(true);
      try { localStorage.setItem('tros-mvloc', v); } catch (e8) {}
      syncMvUI();
      var ok = await mvSwitchTo(v);
      syncMvUI();
      if (!ok) {
        mvRevertSelect();
        mvShowErr('Switch to ' + v + ' failed - reverted, try again');
        return;
      }
      await mvReapply();
      return;
    }
    if (MV_LOCS.indexOf(v) !== -1) {
      setMvEnabled(true);
      try { localStorage.setItem('tros-mvloc', v); } catch (e9) {}
      syncMvUI();
      await mvReapply();
      return;
    }
    setMvEnabled(false);
    syncMvUI();
    await mvReapply();
  }
  locSel.addEventListener('change', async () => {
    await mvHandleSelect();
  });
  document.getElementById('mullvad-cycle').addEventListener('click', async () => {
    var opts = [];
    for (var i = 0; i < locSel.options.length; i++) {
      if (locSel.options[i].value !== 'vps') opts.push(locSel.options[i].value);
    }
    if (!opts.length) return;
    locSel.value = opts[(opts.indexOf(locSel.value) + 1) % opts.length];
    await mvHandleSelect();
  });
  document.getElementById('mullvad-toggle').addEventListener('click', async () => {
    var turnOn = !mvEnabled();
    setMvEnabled(turnOn);
    if (turnOn && locSel.value === 'vps') {
      var last = null;
      try { last = localStorage.getItem('tros-mvloc'); } catch (e4) {}
      var has = false;
      if (last && last !== 'vps') {
        for (var q = 0; q < locSel.options.length; q++) { if (locSel.options[q].value === last) { has = true; break; } }
      }
      var pick = has ? last : mvFirstRelay();
      locSel.value = pick;
      try { localStorage.setItem('tros-loc', pick); } catch (e3) {}
      syncLocSel();
    }
    syncMvUI();
    if (turnOn && RELAY_RE.test(locSel.value)) {
      var ok2 = await mvSwitchTo(locSel.value);
      syncMvUI();
      if (!ok2) {
        mvRevertSelect();
        mvShowErr('Switch failed - reverted, try again');
        return;
      }
    }
    await mvReapply();
  });
  syncLocSel();
  syncMvUI();
  function mvFlag(cc) {
    try {
      var s = String(cc || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
      if (s.length !== 2) return '';
      return String.fromCodePoint(s.charCodeAt(0) + 127397, s.charCodeAt(1) + 127397);
    } catch (e) { return ''; }
  }
  function mvSyncPanelLine() {
    var mc = document.getElementById('mv-current');
    if (!mc) return;
    if (window.TR_OS.vpnConfigured === false) {
      mc.textContent = 'TR-os egen serverproxy · ingen VPN-tunnel';
      return;
    }
    var on2 = false;
    try { on2 = mvEnabled(); } catch (e) {}
    var loc2 = '';
    try { loc2 = localStorage.getItem('tros-loc') || ''; } catch (e2) {}
    if (on2 && loc2 !== 'vps' && MV_STATUS && MV_STATUS.relay) {
      var parts = String(MV_STATUS.relay).split('-');
      mc.textContent = 'vpn: ' + (MV_EXIT_STATE === 'vpn' ? 'verified · ' : 'unverified · ') + mvFlag(parts[0] || '') + ' ' + (parts[1] || '') + ' - ' + MV_STATUS.relay.replace(/\.conf$/, '') + ' · shared exit';
    } else if (!on2 || loc2 === 'vps') {
      mc.textContent = 'vpn: direct (VPS)';
    } else {
      mc.textContent = 'vpn: ...';
    }
  }
  async function mvBuildPanel() {
    var list = document.getElementById('mv-list');
    if (!list) return;
    var data = null;
    try {
      var rr = await window.TR_OS.fetch('api/mullvad/relays');
      data = await rr.json();
    } catch (e) { data = null; }
    list.innerHTML = '';
    if (!data || !data.relays || !data.relays.length) {
      var em = document.createElement('div');
      em.style.cssText = 'padding:16px 8px;color:#8e8e93;font-size:12px;';
      em.textContent = window.TR_OS.vpnConfigured === false ? 'Webbtrafiken går via TR-os egen server. Du behöver inte välja någon extern källa. VPN och val av land kräver en separat VPN-server.' : 'Could not load VPN exits. Reopen this panel to retry.';
      list.appendChild(em);
      return;
    }
    var activeId = null;
    try { activeId = locSel.value; } catch (e2) {}
    var groups = {};
    var order = [];
    data.relays.forEach(function (rel) {
      var g = groups[rel.country];
      if (!g) { g = { country: rel.country, cc: rel.cc, items: [] }; groups[rel.country] = g; order.push(g); }
      g.items.push(rel);
    });
    order.forEach(function (g) {
      var det = document.createElement('details');
      var sum = document.createElement('summary');
      sum.textContent = mvFlag(g.cc) + ' ' + g.country + ' - ' + g.items.length;
      det.appendChild(sum);
      var hasActive = false;
      g.items.forEach(function (rel) {
        var row = document.createElement('div');
        row.className = 'mv-relay' + (rel.id === activeId ? ' mv-active' : '');
        row.textContent = mvFlag(rel.cc) + ' ' + rel.city + ' - ' + rel.id.replace(/\.conf$/, '');
        row.addEventListener('click', async () => {
          locSel.value = rel.id;
          var cur = document.getElementById('mv-current');
          if (cur) { cur.textContent = 'switching to ' + rel.id.replace(/\.conf$/, '') + '...'; }
          await mvHandleSelect();
        });
        if (rel.id === activeId) { hasActive = true; }
        det.appendChild(row);
      });
      if (hasActive) { det.open = true; }
      list.appendChild(det);
    });
  }
  function mvInitPanel() {
    if (window.TR_OS.vpnConfigured === false) {
      var filter = document.getElementById('mv-filter');
      if (filter) filter.hidden = true;
      var panelToggle = document.getElementById('mv-panel-toggle');
      if (panelToggle) panelToggle.closest('label').hidden = true;
    }
    var logo = document.getElementById('mv-logo-btn');
    if (logo && !logo.dataset.wired) {
      logo.dataset.wired = '1';
      logo.addEventListener('click', async (event) => {
        event.stopPropagation();
        var panel = document.getElementById('mv-panel');
        if (!panel) return;
        if (panel.hidden) { panel.hidden = false; await mvBuildPanel(); }
        else { panel.hidden = true; }
      });
    }
    if (!window._mvPanelOut) {
      window._mvPanelOut = true;
      document.addEventListener('click', function (ev) {
        var panel = document.getElementById('mv-panel');
        var lg = document.getElementById('mv-logo-btn');
        if (!panel || panel.hidden) return;
        var tg = ev.target;
        if (panel.contains(tg) || (lg && lg.contains(tg)) || document.getElementById('mv-exit')?.contains(tg)) return;
        panel.hidden = true;
      });
      document.addEventListener('keydown', function (ev) {
        if (ev && ev.key === 'Escape') { var pl = document.getElementById('mv-panel'); if (pl) pl.hidden = true; }
      });
    }
    var filt = document.getElementById('mv-filter');
    if (filt && !filt.dataset.wired) {
      filt.dataset.wired = '1';
      filt.addEventListener('input', function () {
        var q = (filt.value || '').toLowerCase();
        var list = document.getElementById('mv-list');
        if (!list) return;
        var dets = list.querySelectorAll('details');
        dets.forEach(function (det) {
          var any = false;
          det.querySelectorAll('.mv-relay').forEach(function (row) {
            var show = !q || row.textContent.toLowerCase().indexOf(q) !== -1;
            row.style.display = show ? '' : 'none';
            if (show) { any = true; }
          });
          det.style.display = any ? '' : 'none';
          if (q && any) { det.open = true; }
        });
      });
    }
    var ptg = document.getElementById('mv-panel-toggle');
    if (ptg && !ptg.dataset.wired) {
      ptg.dataset.wired = '1';
      ptg.addEventListener('change', function () {
        var hidden = document.getElementById('mullvad-toggle');
        if (!hidden) return;
        var wantOn = ptg.checked;
        var isOn = false;
        try { isOn = mvEnabled(); } catch (e) {}
        if (wantOn !== isOn) { hidden.click(); }
      });
    }
    mvSyncPanelLine();
  }
  mvLoadRelays();
  try {
    var exb = document.getElementById('mv-exit');
    if (exb) { exb.style.cursor = 'pointer'; exb.title = 'Click to re-check live exit'; exb.setAttribute('role','button'); exb.tabIndex=0; const openProxyStatus=async()=>{if(window.TR_OS.vpnConfigured===false){const panel=document.getElementById('mv-panel');if(panel){panel.hidden=false;await mvBuildPanel();}}else await mvCheckExit();}; exb.addEventListener('click', openProxyStatus); exb.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openProxyStatus();}}); }
  } catch (e) {}
  setTimeout(mvCheckExit, 5000);
  mvInitPanel();
  document.getElementById('new-tab').addEventListener('click', () => newTab(HOME));
  document.getElementById('browser-retry').addEventListener('click', () => {
    const tab = activeTab();
    const target = tab?.lastUrl;
    const status = document.getElementById('browser-status');
    if (status) status.hidden = true;
    if (target && target !== HOME) navigate(target);
  });

  const suggestBox = document.getElementById('suggest');
  let suggestItems = [];
  let suggestHi = -1;
  let suggestTimer = null;
  const GLOBE_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14 0 18M12 3c-3 3.5-3 14 0 18"/></svg>';
  const FIND_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="16" y1="16" x2="21" y2="21"/></svg>';
  function readHistory() {
    try {
      const h = JSON.parse(localStorage.getItem('tros-history') || '[]');
      return Array.isArray(h) ? h : [];
    } catch (e) { return []; }
  }
  function recordHistory(title, url) {
    try {
      if (!url || !/^https?:\/\//i.test(url)) return;
      let h = readHistory().filter((x) => x && x.u !== url);
      h.unshift({ t: String(title || url).slice(0, 80), u: url });
      localStorage.setItem('tros-history', JSON.stringify(h.slice(0, 50)));
    } catch (e) {}
  }
  function closeSuggest() {
    suggestItems = [];
    suggestHi = -1;
    if (suggestBox) {
      suggestBox.innerHTML = '';
      suggestBox.style.display = 'none';
    }
  }
  function localMatches(q) {
    const out = [];
    const low = q.toLowerCase();
    try {
      tabs.forEach((t) => {
        if (t.id === activeId) return;
        const label = tabLabel(t);
        const url = t.lastUrl || '';
        if ((label + ' ' + url).toLowerCase().includes(low)) {
          out.push({ kind: 'tab', title: label, sub: displayUrl(url), tabId: t.id, fav: t.favicon || null });
        }
      });
    } catch (e) {}
    try {
      readHistory().forEach((h) => {
        if (!h || !h.u) return;
        if ((h.t + ' ' + h.u).toLowerCase().includes(low)) {
          if (!out.some((o) => o.sub === h.u)) out.push({ kind: 'hist', title: h.t, sub: h.u, fav: null });
        }
      });
    } catch (e) {}
    return out.slice(0, 4);
  }
  function renderSuggest() {
    if (!suggestBox) return;
    suggestBox.innerHTML = '';
    if (!suggestItems.length) {
      suggestBox.style.display = 'none';
      return;
    }
    suggestItems.slice(0, 8).forEach((it, i) => {
      const row = document.createElement('div');
      row.className = 'suggest-row' + (i === suggestHi ? ' hi' : '');
      if (it.fav) {
        const im = document.createElement('img');
        im.src = it.fav;
        im.onerror = () => { im.outerHTML = GLOBE_SVG; };
        row.appendChild(im);
      } else {
        const sp = document.createElement('span');
        sp.className = 'suggest-ic';
        sp.innerHTML = it.kind === 'search' ? FIND_SVG : GLOBE_SVG;
        row.appendChild(sp);
      }
      const t = document.createElement('span');
      t.className = 'suggest-t';
      t.textContent = it.title;
      row.appendChild(t);
      if (it.sub && it.sub !== it.title) {
        const u = document.createElement('span');
        u.className = 'suggest-u';
        u.textContent = it.sub;
        row.appendChild(u);
      }
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pickSuggest(it);
      });
      suggestBox.appendChild(row);
    });
    suggestBox.style.display = 'block';
  }
  function pickSuggest(it) {
    if (!it) return;
    if (it.kind === 'tab') {
      closeSuggest();
      activate(it.tabId);
      return;
    }
    input.value = it.kind === 'search' ? it.title : it.sub;
    closeSuggest();
    navigate(input.value);
  }
  input.addEventListener('input', () => {
    try { clearTimeout(suggestTimer); } catch (e) {}
    const q = input.value.trim();
    if (!q) { closeSuggest(); return; }
    // Keep sensitive terms out of local autocomplete and all suggestion APIs.
    if (containsAdultSearch(q)) { closeSuggest(); return; }
    suggestItems = localMatches(q);
    suggestHi = -1;
    renderSuggest();
    if (/\.[a-z]{2,}/i.test(q) && !/\s/.test(q)) return;
    suggestTimer = setTimeout(async () => {
      if (input.value.trim() !== q) return;
      try {
        let list = [];
        try {
          const r0 = await window.TR_OS.fetch('/suggest?q=' + encodeURIComponent(q));
          const d0 = await r0.json();
          if (Array.isArray(d0.list)) list = d0.list.filter((x) => typeof x === 'string');
        } catch (e0) {}
        if (!list.length && __sjReady && typeof __sj.encodeUrl === 'function') {
          const r = await window.TR_OS.fetch(__sj.encodeUrl('https://ac.duckduckgo.com/ac/?q=' + encodeURIComponent(q) + '&type=list'));
          const d = await r.json();
          if (Array.isArray(d) && Array.isArray(d[1])) list = d[1].filter((x) => typeof x === 'string');
        }
        if (input.value.trim() !== q) return;
        list.forEach((text) => {
          if (suggestItems.length >= 8) return;
          if (!suggestItems.some((o) => o.title === text)) {
            suggestItems.push({ kind: 'search', title: text, sub: '', fav: null });
          }
        });
        renderSuggest();
      } catch (e) {}
    }, 180);
  });
  input.addEventListener('keydown', (e) => {
    if (suggestBox && suggestBox.style.display === 'block' && suggestItems.length) {
      const n = Math.min(suggestItems.length, 8);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        suggestHi = e.key === 'ArrowDown' ? (suggestHi + 1) % n : (suggestHi - 1 + n) % n;
        renderSuggest();
        return;
      }
      if (e.key === 'Enter' && suggestHi >= 0 && suggestItems[suggestHi]) {
        e.preventDefault();
        pickSuggest(suggestItems[suggestHi]);
        return;
      }
      if (e.key === 'Escape') { closeSuggest(); return; }
    }
    if (e.key === 'Enter' && input.value.trim()) { closeSuggest(); navigate(input.value); }
  });
  input.addEventListener('blur', () => { setTimeout(closeSuggest, 120); });

  newTab(HOME);
})();
