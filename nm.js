 (() => {
  'use strict';

  const KEY  = '3a73619bbb8fc6d47742d1b5b2b707b5';
  const BASE = 'https://api.themoviedb.org/3';
  const IMG  = p => p ? `https://image.tmdb.org/t/p/w342${p}` : '';
  // Mullvad VPN (tros toggle): same-origin relays that exit via the tunnel.
  const MV_ON = () => { if (window.TR_OS.vpnConfigured === false) return false; try { return localStorage.getItem('tros-mullvad') !== '0'; } catch (e) { return true; } };
  let __tmdbProxyEnabled = MV_ON();
  const mvApi = path => __tmdbProxyEnabled ? 'api/tmdb' + path : BASE + path;
  const mvImg = itemPath => {
    if (!itemPath) return '';
    if (__tmdbProxyEnabled) return window.TR_OS.apiUrl('api/tmdb-img/t/p/w342' + itemPath);
    return IMG(itemPath);
  };
  async function readJsonSafe(res) {
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('application/json')) return res.json();
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return null; }
  }
  async function tmdbJson(path) {
    if (__tmdbProxyEnabled) {
      try {
        const proxyRes = await window.TR_OS.fetch('api/tmdb' + path);
        if (proxyRes.ok) {
          const data = await readJsonSafe(proxyRes);
          if (data && typeof data === 'object') return data;
        }
      } catch (e) {}
      __tmdbProxyEnabled = false;
    }
    const directRes = await window.TR_OS.fetch(BASE + path);
    if (!directRes.ok) throw new Error(`tmdb-${directRes.status}`);
    const data = await readJsonSafe(directRes);
    if (!data || typeof data !== 'object') throw new Error('tmdb-invalid-json');
    return data;
  }
  const ANIME_PX = '&with_original_language=ja&with_genres=16';

  let __sjPlay = null, __sjPlayReady = false, __sjPlayPromise = null, __sjPlayError = null, __sjPlayStage = '', __barePlay = null, __barePlayWorker = null, __scramjetLoadPromise = null;

  function movieHostWindow() {
    try {
      if (window.parent !== window && window.parent.location.origin === window.location.origin && window.parent.TR_OS) return window.parent;
    } catch (_) {}
    return window;
  }

  function loadMovieScramjet(host, runtime) {
    if (typeof host.$scramjetLoadController === 'function') {
      return Promise.resolve().then(() => host.$scramjetLoadController());
    }
    if (!__scramjetLoadPromise) {
      __scramjetLoadPromise = new Promise((resolve, reject) => {
        const script = host.document.createElement('script');
        script.src = runtime.assetUrl('scram/scramjet.all.js');
        script.async = true;
        script.onload = () => {
          if (typeof host.$scramjetLoadController !== 'function') {
            reject(new Error('Scramjet controller did not load.'));
            return;
          }
          try { resolve(host.$scramjetLoadController()); } catch (error) { reject(error); }
        };
        script.onerror = () => reject(new Error('Scramjet script could not be loaded.'));
        host.document.head.appendChild(script);
      }).catch(error => { __scramjetLoadPromise = null; throw error; });
    }
    return __scramjetLoadPromise;
  }

  function createMovieMuxConnection(preferDedicated = false) {
    const workerUrl = window.TR_OS.assetUrl('baremux/worker.js');
    if (!preferDedicated && typeof SharedWorker === 'function') {
      try { return new BareMux.BareMuxConnection(workerUrl); }
      catch (error) { console.warn('TR-os shared movie worker unavailable:', error); }
    }
    if (typeof Worker === 'function' && typeof MessageChannel === 'function') {
      let worker;
      try {
        worker = new Worker(window.TR_OS.assetUrl('baremux/compat-worker.js'));
        const channel = new MessageChannel();
        worker.postMessage({ type: 'tros-connect' }, [channel.port2]);
        __barePlayWorker = worker;
        return new BareMux.BareMuxConnection(channel.port1);
      } catch (error) {
        try { worker?.terminate(); } catch (_) {}
        console.warn('TR-os dedicated movie worker unavailable:', error);
      }
    }
    if (!preferDedicated && typeof SharedWorker === 'function') return new BareMux.BareMuxConnection(workerUrl);
    throw new Error('movie-worker-unavailable');
  }

  async function setMovieTransport(conn) {
    const transport = [{ wisp: window.TR_OS.wispUrl('/wisp-movies/') }];
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await window.TR_OS.withTimeout(conn.setTransport(window.TR_OS.assetUrl('epoxy/index.mjs'), transport),
          12000, 'Filmtransporten kunde inte ansluta i tid.');
        return null;
      } catch (error) {
        lastError = error;
        if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
    return lastError;
  }

  async function ensurePlayerProxy() {
    if (__sjPlayReady) return true;
    if (__sjPlayPromise) return __sjPlayPromise;
    __sjPlayPromise = (async () => {
      __sjPlayStage = 'service-worker';
      const host = movieHostWindow();
      const hostRuntime = host.TR_OS || window.TR_OS;
      if (hostRuntime !== window.TR_OS) await hostRuntime.ensureServiceWorker();
      await window.TR_OS.ensureServiceWorker();

      __sjPlayStage = 'scramjet';
      const { ScramjetController } = await loadMovieScramjet(host, hostRuntime);
      if (typeof ScramjetController !== 'function') throw new Error('Scramjet controller is unavailable.');
      const client = new ScramjetController({
        files: {
          wasm: window.TR_OS.assetUrl('scram/scramjet.wasm.wasm'),
          all: window.TR_OS.assetUrl('scram/scramjet.all.js'),
          sync: window.TR_OS.assetUrl('scram/scramjet.sync.js'),
        },
      });
      await hostRuntime.withTimeout(client.init(), 45000, 'Filmens proxy kunde inte starta i tid.');

      __sjPlayStage = 'movie-worker';
      let conn = createMovieMuxConnection();
      __sjPlayStage = 'transport';
      let transportError = await setMovieTransport(conn);
      if (transportError && !__barePlayWorker && typeof Worker === 'function' && typeof MessageChannel === 'function') {
        try {
          conn = createMovieMuxConnection(true);
          transportError = await setMovieTransport(conn);
        } catch (error) { transportError = error; }
      }
      if (transportError) throw transportError;
      window.__TR_OS_POPUP_GUARD__?.installPopups();
      __barePlay = conn;
      __sjPlay = client;
      __sjPlayError = null;
      __sjPlayStage = '';
      __sjPlayReady = true;
      return true;
    })().catch(error => {
      __sjPlayError = error;
      try { __barePlayWorker?.terminate(); } catch (_) {}
      __barePlayWorker = null;
      console.warn('TR-os movie connection could not start at ' + (__sjPlayStage || 'unknown stage') + ':', error);
      return false;
    }).finally(() => { __sjPlayPromise = null; });
    return __sjPlayPromise;
  }

  async function proxyPlayerUrl(url) {
    // Route movie sources through TR-os so the popup guard runs before the
    // provider code and the iframe can remain sandboxed on every browser.
    try {
      const ok = await ensurePlayerProxy();
      if (!ok || !__sjPlayReady) return null;
      return __sjPlay.encodeUrl(url);
    } catch (e) { return null; }
  }
  const movieUrl = id       => `https://vidfast.vc/movie/${id}`;
  const tvUrl    = (id,s,e) => `https://vidfast.vc/tv/${id}/${s}/${e}`;

  const CATS = [
    { n: 'Trending',          ep: 'trending/all/week',  px: '',                                                          t: null    },
    { n: 'Popular Movies',    ep: 'discover/movie',     px: '&sort_by=popularity.desc',                                  t: 'movie' },
    { n: 'Popular TV',        ep: 'discover/tv',        px: '&sort_by=popularity.desc',                                  t: 'tv'    },
    { n: 'Anime',             ep: 'discover/tv',        px: `${ANIME_PX}&sort_by=popularity.desc`,                       t: 'tv'    },
    { n: 'Top Rated Movies',  ep: 'discover/movie',     px: '&sort_by=vote_average.desc&vote_count.gte=500',             t: 'movie' },
    { n: 'Action',            ep: 'discover/movie',     px: '&with_genres=28&sort_by=popularity.desc',                   t: 'movie' },
    { n: 'Sci-Fi',            ep: 'discover/movie',     px: '&with_genres=878&sort_by=popularity.desc',                  t: 'movie' },
    { n: 'Horror',            ep: 'discover/movie',     px: '&with_genres=27&sort_by=popularity.desc',                   t: 'movie' },
    { n: 'Drama Series',      ep: 'discover/tv',        px: '&with_genres=18&sort_by=popularity.desc',                   t: 'tv'    },
    { n: 'Anime Films',       ep: 'discover/movie',     px: `${ANIME_PX}&sort_by=popularity.desc`,                       t: 'movie' },
    { n: 'Comedy',            ep: 'discover/movie',     px: '&with_genres=35&sort_by=popularity.desc',                   t: 'movie' },
    { n: 'Top Anime',         ep: 'discover/tv',        px: `${ANIME_PX}&sort_by=vote_average.desc&vote_count.gte=200`,  t: 'tv'    },
  ];

  const style = document.createElement('style');
  style.textContent = `
    @keyframes npulse  { 0%,100%{opacity:.45}50%{opacity:.85} }
    @keyframes nfadeIn { from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)} }
    @keyframes nslideUp{ from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)} }

    .tros-row::-webkit-scrollbar{display:none}
    .tros-row{scrollbar-width:none;-ms-overflow-style:none}
    .tros-card img{transition:transform .3s ease}
    .tros-card:hover img{transform:scale(1.04)}

    /* ── modal overlay ── */
    #tros-overlay{
      position:fixed;inset:0;z-index:9000;
      background:rgba(0,0,0,.75);
      display:none;align-items:center;justify-content:center;
      padding:16px;
    }
    #tros-overlay.open{ display:flex }

    /* ── modal box — matches TR-os palette ── */
    #tros-modal{
      background:#93c5fd;          /* bg-blue-300 */
      border:2px solid #60a5fa;    /* border-blue-400 */
      border-radius:18px;
      width:min(540px,100%);
      max-height:92vh;
      overflow-y:auto;
      display:flex;
      flex-direction:column;
      animation:nfadeIn .22s ease;
      position:relative;
      padding:20px;
      gap:16px;
    }

    /* close btn */
    #tros-modal-close{
      position:absolute;top:14px;right:14px;
      width:32px;height:32px;border-radius:50%;
      background:rgba(255,255,255,.35);
      border:1px solid rgba(255,255,255,.5);
      color:#1d4ed8;font-size:16px;
      display:grid;place-items:center;
      cursor:pointer;transition:background .2s;
      line-height:1;
    }
    #tros-modal-close:hover{ background:rgba(255,255,255,.6) }

    /* header row */
    #tros-modal-header{
      display:flex;gap:14px;align-items:flex-start;
    }
    #tros-modal-poster{
      width:100px;height:150px;object-fit:cover;
      border-radius:10px;flex-shrink:0;
      border:2px solid #60a5fa;
      background:#bfdbfe;
    }
    #tros-modal-info{ flex:1;min-width:0 }
    #tros-modal-title{
      font-family:ui-sans-serif,system-ui,sans-serif;
      color:#1e3a5f;font-size:22px;
      line-height:1.2;margin-bottom:6px;
    }
    #tros-modal-meta{
      font-size:12px;color:#1d4ed8;
      font-weight:700;margin-bottom:10px;
    }
    #tros-modal-overview{
      font-size:12.5px;color:#1e3a5f;
      line-height:1.6;
      display:-webkit-box;-webkit-line-clamp:5;
      -webkit-box-orient:vertical;overflow:hidden;
    }

    /* selects */
    .tros-sel{
      background:#bfdbfe;
      border:1.5px solid #60a5fa;
      color:#1e3a5f;padding:9px 12px;
      border-radius:9px;
      font-family:ui-sans-serif,system-ui,sans-serif;
      font-size:13px;outline:none;cursor:pointer;
      flex:1;min-width:130px;
    }
    .tros-sel option{ background:#bfdbfe;color:#1e3a5f }

    /* controls row */
    #tros-modal-controls{
      display:flex;flex-wrap:wrap;gap:10px;align-items:center;
    }

    /* watch / play btn */
    #tros-watch-btn{
      background:#1d4ed8;
      border:none;color:#fff;
      padding:11px 28px;border-radius:10px;
      font-family:ui-sans-serif,system-ui,sans-serif;font-size:15px;
      cursor:pointer;transition:background .2s,transform .15s;
      display:flex;align-items:center;gap:8px;
      white-space:nowrap;width:100%;justify-content:center;
      margin-top:4px;
    }
    #tros-watch-btn:hover{ background:#1e40af;transform:translateY(-2px) }
    #tros-watch-btn svg{ width:18px;height:18px;fill:#fff }

    /* loading text */
    #tros-season-loading{
      font-family:ui-sans-serif,system-ui,sans-serif;
      color:#1d4ed8;font-size:13px;
    }

    /* ── fullscreen player ── */
    #tros-player{
      position:fixed;inset:0;z-index:9500;
      background:#000;
      display:none;flex-direction:column;
    }
    #tros-player.open{ display:flex }

    #tros-player-bar{
      position:absolute;top:0;left:0;right:0;
      min-height:72px;z-index:10;
      background:linear-gradient(180deg,rgba(0,0,0,.94),rgba(0,0,0,.72));
      border-bottom:1px solid rgba(255,255,255,.12);
      backdrop-filter:blur(18px);
      display:grid;grid-template-columns:44px minmax(0,1fr) auto auto auto;
      align-items:center;padding:calc(env(safe-area-inset-top,0px) + 10px) 18px 10px;gap:10px;
    }
    #tros-player-heading{min-width:0;overflow:hidden}
    #tros-player-source,#tros-player-next,#tros-player-fullscreen{
      flex:0 0 auto;min-width:0;width:auto;max-width:none;
      height:42px;padding:7px 12px;font-size:12px;border-radius:13px;
      white-space:nowrap;
    }
    #tros-player-source,#tros-player-next{
      background:var(--tros-card,#111);border:1px solid var(--tros-border,#333);
      color:var(--tros-text,#fff);
    }
    #tros-player-source{width:116px;cursor:pointer}
    #tros-player-next{min-width:108px;cursor:pointer}
    #tros-player-fullscreen{
      border:1px solid var(--tros-accent,#fff);background:var(--tros-accent,#fff);
      color:var(--tros-onacc,#000);font-weight:800;cursor:pointer;
    }
    #tros-player-back{
      width:42px;height:42px;border-radius:14px;
      background:var(--tros-card,#181818);
      border:1px solid var(--tros-border,#444);
      color:var(--tros-text,#fff);font-size:22px;
      display:grid;place-items:center;
      cursor:pointer;transition:background .2s;
    }
    #tros-player-back:hover{ background:var(--tros-border,#333) }
    #tros-player-title{
      font-family:ui-sans-serif,system-ui,sans-serif;
      color:var(--tros-text,#fff);font-size:16px;font-weight:800;
      overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
    }
    #tros-player-sub{
      overflow:hidden;margin-top:3px;color:var(--tros-text,rgba(255,255,255,.65));
      font-size:11px;opacity:.72;text-overflow:ellipsis;white-space:nowrap;
    }
    #tros-player-status{
      position:absolute;inset:90px 16px 16px;z-index:2;display:none;
      align-items:center;justify-content:center;padding:28px;
      border:1px solid var(--tros-border,#263542);border-radius:22px;
      background:radial-gradient(ellipse at 50% 35%,var(--tros-card,#111) 0%,#080b0f 74%);
      color:var(--tros-text,#d7e8f4);font-size:15px;font-weight:650;
      line-height:1.65;text-align:center;backdrop-filter:blur(16px);
    }
    #tros-frame{
      width:100%;flex:1;min-height:0;
      border:none;display:block;
    }
    @media(max-width:600px){
      #tros-player-bar{
        min-height:0;grid-template-columns:repeat(3,minmax(0,1fr));
        grid-template-rows:auto auto;gap:8px;
        padding:calc(env(safe-area-inset-top,0px) + 9px) max(10px,env(safe-area-inset-right,0px)) 10px max(10px,env(safe-area-inset-left,0px));
      }
      #tros-player-back{grid-column:1;grid-row:1;width:42px;height:42px}
      #tros-player-heading{grid-column:2/4;grid-row:1}
      #tros-player-title{font-size:14px}
      #tros-player-sub{display:block;font-size:10px}
      #tros-player-source{grid-column:1;grid-row:2;width:100%}
      #tros-player-next{grid-column:2;grid-row:2;width:100%;min-width:0}
      #tros-player-fullscreen{grid-column:3;grid-row:2;width:100%;padding-right:6px;padding-left:6px;font-size:11px}
      #tros-player-source,#tros-player-next,#tros-player-fullscreen{height:40px;border-radius:12px}
      #tros-player-status{inset:126px 10px 10px;padding:22px 16px;font-size:14px}
    }
  `;
  document.head.appendChild(style);

  document.addEventListener('DOMContentLoaded', boot);

  let grid, searchWrap;
  let currentItem = null;

  function boot() {
    const input = document.querySelector('input[type="text"]');
    if (!input) return;
    searchWrap = input.closest('div');
    grid = searchWrap?.parentElement;
    if (!grid) return;

    Object.assign(grid.style, {
      height: 'auto', minHeight: '765px',
      overflowY: 'auto', overflowX: 'hidden',
    });

    wipeSections();
    CATS.forEach(cat => loadSection(cat));
    buildDOM();

    let timer;
    input.addEventListener('input', e => {
      clearTimeout(timer);
      const q = e.target.value.trim();
      if (!q) { wipeSections(); CATS.forEach(c => loadSection(c)); return; }
      timer = setTimeout(() => doSearch(q), 480);
    });
  }

  function wipeSections() {
    [...grid.children].forEach(el => { if (el !== searchWrap) el.remove(); });
  }

  function buildDOM() {
    if (document.getElementById('tros-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'tros-overlay';
    overlay.innerHTML = `
      <div id="tros-modal">
        <button id="tros-modal-close">✕</button>
        <div id="tros-modal-header">
          <img id="tros-modal-poster" src="" alt="">
          <div id="tros-modal-info">
            <div id="tros-modal-title"></div>
            <div id="tros-modal-meta"></div>
            <div id="tros-modal-overview"></div>
          </div>
        </div>
        <div id="tros-modal-controls"></div>
        <button id="tros-watch-btn">
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
          Watch Now
        </button>
      </div>`;
    document.body.appendChild(overlay);

    const player = document.createElement('div');
    player.id = 'tros-player';
    player.innerHTML = `
      <div id="tros-player-bar">
        <button id="tros-player-back" type="button" aria-label="Tillbaka till Movies" title="Tillbaka till Movies">←</button>
        <div id="tros-player-heading">
          <div id="tros-player-title"></div>
          <div id="tros-player-sub"></div>
        </div>
        <select id="tros-player-source" class="tros-sel" aria-label="Videokälla"><option>VidFast</option><option>VidLink</option><option>VidLink JW</option></select>
        <button id="tros-player-next" class="tros-sel" type="button">Byt källa</button>
        <button id="tros-player-fullscreen" class="tros-sel" type="button" aria-pressed="false">⛶ Fullskärm</button>
      </div>
      <div id="tros-player-status" role="status" aria-live="polite"></div>
      <iframe id="tros-frame"
        sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
        allowfullscreen
        allow="autoplay;fullscreen;picture-in-picture;encrypted-media"
        referrerpolicy="no-referrer">
      </iframe>`;
    document.body.appendChild(player);

    document.getElementById('tros-modal-close').addEventListener('click', closeModal);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
    document.getElementById('tros-watch-btn').addEventListener('click', onWatchClick);
    document.getElementById('tros-player-back').addEventListener('click', closeFullscreen);
    document.getElementById('tros-player-fullscreen').addEventListener('click', async () => {
      const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      const request = player.requestFullscreen || player.webkitRequestFullscreen;
      try {
        if (isFullscreen && exit) await exit.call(document);
        else if (!isFullscreen && request) await request.call(player);
        else document.getElementById('tros-player-sub').textContent = 'Spelaren visas redan i helskärmsvyn.';
      } catch { document.getElementById('tros-player-sub').textContent = 'Spelaren visas redan i helskärmsvyn.'; }
    });
    document.addEventListener('fullscreenchange', () => {
      const button = document.getElementById('tros-player-fullscreen');
      const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
      button.textContent = isFullscreen ? '⛶ Avsluta fullskärm' : '⛶ Fullskärm';
      button.setAttribute('aria-pressed', String(isFullscreen));
    });
    document.addEventListener('webkitfullscreenchange', () => document.dispatchEvent(new Event('fullscreenchange')));
    document.getElementById('tros-player-source').addEventListener('change', e => changePlayerSource(e.target.selectedIndex));
    document.getElementById('tros-player-next').addEventListener('click', () => changePlayerSource((playerSource + 1) % 3));
    document.getElementById('tros-frame').addEventListener('load', () => {
      if (playerFrameGeneration !== playerGeneration) return;
      playerFrameLoaded = true;
      installMovieAdBlock(document.getElementById('tros-frame'));
      try {
        const doc = document.getElementById('tros-frame').contentDocument;
        const text = doc && doc.body && doc.body.innerText || '';
        if (/please disable sandbox/i.test(text)) {
          failedPlayerSource(playerGeneration);
          return;
        }
        if (doc?.querySelector('[data-tros-proxy-error]') || /This page could not be loaded through TR-os|There was an error loading|Proxy is not ready/.test(text)) {
          failedPlayerSource(playerGeneration);
          return;
        }
      } catch (_) {}
      document.getElementById('tros-frame').style.visibility = 'visible';
      document.getElementById('tros-player-status').style.display = 'none';
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (document.getElementById('tros-player').classList.contains('open')) closeFullscreen();
        else closeModal();
      }
    });
  }

  function installMovieAdBlock(frame) {
    try {
      const doc = frame.contentDocument;
      if (!doc?.documentElement || doc.documentElement.dataset.trosMovieAdBlock === '1') return;
      doc.documentElement.dataset.trosMovieAdBlock = '1';
      const script = doc.createElement('script');
      script.src = new URL('/frame-controls.js?v=20261020.7', location.origin).href;
      script.async = false;
      (doc.head || doc.documentElement).appendChild(script);
    } catch (_) {
      // Cross-origin player pages cannot be modified by this same-origin blocker.
    }
  }

  // ── modal open ───────────────────────────────────────────────────
  async function openModal(item) {
    currentItem = item;
    const title = item.title || item.name || '—';
    const year  = (item.release_date || item.first_air_date || '').slice(0, 4);
    const type  = item.media_type === 'tv' ? 'TV Series' : 'Movie';
    const score = item.vote_average ? `★ ${item.vote_average.toFixed(1)}` : '';

    document.getElementById('tros-modal-poster').src          = mvImg(item.poster_path);
    document.getElementById('tros-modal-title').textContent   = title;
    document.getElementById('tros-modal-meta').textContent    = [type, year, score].filter(Boolean).join('  ·  ');
    document.getElementById('tros-modal-overview').textContent = item.overview || '';
    document.getElementById('tros-modal-controls').innerHTML  = '';
    document.getElementById('tros-watch-btn').textContent     = '';

    const btn = document.getElementById('tros-watch-btn');
    btn.innerHTML = `<svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:#fff"><path d="M8 5v14l11-7z"/></svg> Watch Now`;

    document.getElementById('tros-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';

    if (item.media_type === 'tv') {
      await buildTVControls(item);
    }
  }

  function closeModal() {
    document.getElementById('tros-overlay').classList.remove('open');
    document.body.style.overflow = '';
    currentItem = null;
  }

  async function buildTVControls(item) {
    const ctrl = document.getElementById('tros-modal-controls');
    ctrl.innerHTML = `<span id="tros-season-loading">Loading seasons…</span>`;

    let tvData;
    try {
      tvData = await tmdbJson(`/tv/${item.id}?api_key=${KEY}`);
    } catch {
      ctrl.innerHTML = `<span style="color:#dc2626;font-family:ui-sans-serif,system-ui,sans-serif;font-size:13px">Failed to load seasons.</span>`;
      return;
    }

    const seasons = (tvData.seasons || []).filter(s => s.season_number > 0);
    ctrl.innerHTML = '';

    if (!seasons.length) return;

    const seasonSel = document.createElement('select');
    seasonSel.className = 'tros-sel';
    seasonSel.id = 'tros-season-sel';
    seasons.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.season_number;
      opt.textContent = s.name || `Season ${s.season_number}`;
      seasonSel.appendChild(opt);
    });

    const epSel = document.createElement('select');
    epSel.className = 'tros-sel';
    epSel.id = 'tros-ep-sel';

    ctrl.appendChild(seasonSel);
    ctrl.appendChild(epSel);

    async function loadEps(sNum) {
      epSel.innerHTML = '<option>Loading…</option>';
      try {
        const d = await tmdbJson(`/tv/${item.id}/season/${sNum}?api_key=${KEY}`);
        const eps = d.episodes || [];
        epSel.innerHTML = '';
        eps.forEach(e => {
          const opt = document.createElement('option');
          opt.value = e.episode_number;
          opt.textContent = `Ep ${e.episode_number}: ${e.name || '—'}`;
          epSel.appendChild(opt);
        });
      } catch {
        epSel.innerHTML = '<option value="1">Episode 1</option>';
      }
    }

    await loadEps(+seasonSel.value);
    seasonSel.addEventListener('change', () => loadEps(+seasonSel.value));
  }

  function onWatchClick() {
    if (!currentItem) return;
    const item = currentItem;
    const title = item.title || item.name || '—';

    let src, sub;

    if (item.media_type === 'movie') {
      src = movieUrl(item.id);
      sub = 'Full Movie — VidFast HD';
    } else {
      const sSel = document.getElementById('tros-season-sel');
      const eSel = document.getElementById('tros-ep-sel');
      const s = Number(sSel?.value) || 1;
      const e = Number(eSel?.value) || 1;
      const sName = sSel ? sSel.options[sSel.selectedIndex]?.text : `Season ${s}`;
      const eName = eSel ? eSel.options[eSel.selectedIndex]?.text : `Episode ${e}`;
      src = tvUrl(item.id, s, e);
      sub = `${sName}  ·  ${eName} — VidFast HD`;
    }

    launchFullscreen(src, title, sub);
  }

  let playerSource = 0, playerPath = '', playerGeneration = 0;
  let playerFrameGeneration = 0, playerFrameLoaded = false;
  function notifyMobilePlayer(open) {
    try {
      if (window.parent !== window) window.parent.postMessage({ trosMobilePlayer: open ? 'open' : 'close' }, location.origin);
    } catch (_) {}
  }
  function failedPlayerSource(generation) {
    if (generation !== playerGeneration || !playerPath) return;
    const frame = document.getElementById('tros-frame');
    frame.style.visibility = 'hidden';
    {
      ++playerGeneration;
      frame.src = 'about:blank';
      document.getElementById('tros-player-sub').textContent = 'Källan kunde inte laddas. Välj en annan källa ovan.';
      const status = document.getElementById('tros-player-status');
      status.textContent = 'Den här källan kunde inte laddas just nu. Välj en annan källa ovan eller tryck på Byt källa. Inget byte sker automatiskt.';
      status.style.display = 'flex';
    }
  }
  async function changePlayerSource(index) {
    const status = document.getElementById('tros-player-status');
    status.textContent = 'Startar filmanslutningen…';
    status.style.display = 'flex';
    document.getElementById('tros-frame').style.visibility = 'hidden';
    playerSource = index;
    const generation = ++playerGeneration;
    const sources = [
      { name: 'VidFast', url: path => 'https://vidfast.vc' + path },
      { name: 'VidLink', url: path => 'https://vidlink.pro' + path },
      { name: 'VidLink JW', url: path => 'https://vidlink.pro' + path + '?player=jw' },
    ];
    const selected = sources[index] || sources[0];
    playerSource = sources.indexOf(selected);
    document.getElementById('tros-player-source').selectedIndex = playerSource;
    document.getElementById('tros-player-sub').textContent = selected.name + ' · Popupskydd på';
    const src = await proxyPlayerUrl(selected.url(playerPath));
    if (generation !== playerGeneration) return;
    const frame = document.getElementById('tros-frame');
    if (!src) {
      frame.src = 'about:blank';
      document.getElementById('tros-player-sub').textContent = 'Den skyddade filmanslutningen kunde inte starta';
      const reason = __sjPlayStage === 'shared-worker'
        ? 'Den här webbläsaren saknar stöd för den delade worker som filmanslutningen behöver. Öppna sidan direkt i Safari och ladda om.'
        : __sjPlayStage === 'service-worker'
          ? 'Safari kunde inte starta webbproxyn. Stäng sidan, öppna den direkt i Safari och ladda om.'
          : 'Filmanslutningen kunde inte starta (' + (__sjPlayStage || 'okänt steg') + '). Ladda om sidan och försök igen.';
      status.textContent = reason;
      status.style.display = 'flex';
      return;
    }
    playerFrameGeneration = generation;
    playerFrameLoaded = false;
    frame.src = src;
    setTimeout(() => {
      if (generation !== playerGeneration) return;
      if (!playerFrameLoaded) { failedPlayerSource(generation); return; }
      try {
        const text = frame.contentDocument?.body?.innerText || '';
        if (frame.contentDocument?.querySelector('[data-tros-proxy-error]') || /there was an error loading|this page could not be loaded through TR-os/i.test(text)) failedPlayerSource(generation);
      } catch (_) {}
    }, 25000);
  }
  async function launchFullscreen(src, title, sub) {
    document.getElementById('tros-player-title').textContent = title;
    document.getElementById('tros-player-sub').textContent   = sub;
    playerPath = new URL(src).pathname;
    const player = document.getElementById('tros-player');
    const status = document.getElementById('tros-player-status');
    status.textContent = 'Startar filmanslutningen…';
    status.style.display = 'flex';
    player.classList.add('open');
    notifyMobilePlayer(true);
    closeModal();
    document.body.style.overflow = 'hidden';
    try {
      await changePlayerSource(0);
    } catch (_) {
      if (player.classList.contains('open')) {
        status.textContent = 'Filmspelaren kunde inte starta. Tryck på Byt källa eller försök igen.';
        status.style.display = 'flex';
      }
    }
  }

  function closeFullscreen() {
    ++playerGeneration;
    playerPath = '';
    document.getElementById('tros-player').classList.remove('open');
    notifyMobilePlayer(false);
    document.getElementById('tros-frame').src = 'about:blank';
    document.body.style.overflow = '';
  }

  function mkShell(title) {
    const wrap = document.createElement('div');
    wrap.className = 'w-full';
    wrap.style.marginBottom = '4px';

    const lbl = document.createElement('p');
    lbl.className = 'font-sans text-blue-600 px-3 pt-2 pb-1';
    lbl.style.fontSize = '18px';
    lbl.textContent = title;

    const row = document.createElement('div');
    row.className = 'tros-row';
    Object.assign(row.style, {
      display: 'flex', overflowX: 'auto',
      gap: '10px', padding: '4px 12px 10px',
    });

    for (let i = 0; i < 8; i++) row.appendChild(mkSkel());
    wrap.appendChild(lbl);
    wrap.appendChild(row);
    return { wrap, row };
  }

  async function loadSection(cat) {
    const { wrap, row } = mkShell(cat.n);
    grid.appendChild(wrap);
    try {
      let url = `/${cat.ep}?api_key=${KEY}&language=en-US&page=1`;
      if (cat.px) url += cat.px;
      const d = await tmdbJson(url);
      const items = (d.results || [])
        .filter(i => i.poster_path)
        .map(i => ({ ...i, media_type: i.media_type || cat.t }))
        .slice(0, 20);
      row.innerHTML = '';
      if (!items.length) {
        row.innerHTML = '<p class="font-sans text-blue-500 text-sm p-4">Nothing here.</p>';
        return;
      }
      items.forEach(i => row.appendChild(mkCard(i)));
    } catch {
      row.innerHTML = '<p class="font-sans text-blue-500 text-sm p-4">Failed to load.</p>';
    }
  }

  async function doSearch(q) {
    wipeSections();
    const { wrap, row } = mkShell(`Results for "${q}"`);
    grid.appendChild(wrap);
    try {
      const [tvR, movR] = await Promise.all([
        tmdbJson(`/search/tv?api_key=${KEY}&query=${encodeURIComponent(q)}&language=en-US`),
        tmdbJson(`/search/movie?api_key=${KEY}&query=${encodeURIComponent(q)}&language=en-US`),
      ]);
      const items = [
        ...(tvR.results  || []).filter(i => i.poster_path).map(i => ({ ...i, media_type: 'tv'    })),
        ...(movR.results || []).filter(i => i.poster_path).map(i => ({ ...i, media_type: 'movie' })),
      ].sort((a, b) => (b.popularity || 0) - (a.popularity || 0)).slice(0, 40);
      row.innerHTML = '';
      if (!items.length) {
        row.innerHTML = '<p class="font-sans text-blue-500 text-sm p-4">No results found.</p>';
        return;
      }
      items.forEach(i => row.appendChild(mkCard(i)));
    } catch {
      row.innerHTML = '<p class="font-sans text-blue-500 text-sm p-4">Search failed.</p>';
    }
  }

  function mkCard(item) {
    const title = item.title || item.name || '—';
    const year  = (item.release_date || item.first_air_date || '').slice(0, 4);
    const type  = item.media_type === 'tv' ? 'TV' : 'Film';

    const card = document.createElement('div');
    card.className = 'tros-card bg-blue-400 border-2 border-blue-400 p-2 rounded-xl flex flex-col items-center justify-start cursor-pointer hover:bg-blue-300 transition-all relative';
    Object.assign(card.style, { flex: '0 0 auto', width: '155px', minHeight: '255px' });

    card.innerHTML = `
      <img src="${mvImg(item.poster_path)}" alt="${esc(title)}"
        loading="lazy" class="w-full rounded-md object-cover" style="height:195px">
      <p class="font-sans text-blue-600 text-center w-full mt-2"
        style="font-size:13px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">
        ${esc(title)}
      </p>
      <div style="display:flex;justify-content:space-between;width:100%;margin-top:4px">
        <p class="font-sans text-blue-500" style="font-size:11px">${esc(year)}</p>
        <p class="font-sans text-blue-500" style="font-size:11px">${esc(type)}</p>
      </div>`;

    card.addEventListener('click', () => openModal(item));
    return card;
  }

  function mkSkel() {
    const s = document.createElement('div');
    Object.assign(s.style, {
      flex: '0 0 155px', height: '255px', borderRadius: '12px',
      background: 'rgba(147,197,253,0.45)',
      animation: 'npulse 1.5s ease-in-out infinite',
    });
    return s;
  }

  function esc(s) {
    return String(s || '').replace(/[&<>"']/g,
      c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

})();
