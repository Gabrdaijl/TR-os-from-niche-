(function () {

  const STORAGE_KEY = 'tros-dark';
  const THEME_KEY = 'tros-theme';
  const WALL_KEY = 'tros-wallpaper';
  function getWallpaper() {
    try {
      const v = localStorage.getItem(WALL_KEY);
      if (typeof v === 'string' && v.indexOf('data:image/') === 0) return v;
    } catch (e) {}
    return null;
  }
  function applyWallpaper() {
    try {
      const w = getWallpaper();
      const root = document.documentElement;
      try {
        if (w) root.classList.add('has-wallpaper');
        else root.classList.remove('has-wallpaper');
      } catch (e2) {}
      if (!root) return;
      if (w) {
        root.style.backgroundImage = 'url("' + w + '")';
        root.style.backgroundSize = 'cover';
        root.style.backgroundPosition = 'center';
        root.style.backgroundAttachment = 'fixed';
        root.style.backgroundRepeat = 'no-repeat';
      } else {
        root.style.backgroundImage = '';
        root.style.backgroundSize = '';
        root.style.backgroundPosition = '';
        root.style.backgroundAttachment = '';
        root.style.backgroundRepeat = '';
      }
    } catch (e) {}
  }
  function setWallpaper(dataUrl) {
    try {
      if (dataUrl) localStorage.setItem(WALL_KEY, dataUrl);
      else localStorage.removeItem(WALL_KEY);
    } catch (e) {}
    applyWallpaper();
  }
  const THEMES = {
    dark:      { ACCENT: '#ffffff', CARD_BG: '#111111', BORDER: '#2b2b2b', BG: '#000000', TEXT: '#ffffff', NAV_BTN: '#161616', STAR: '255,255,255', ICON: '#ffffff', ONACC: '#000000', HOV: '#1f1f1f' },
    halloween: { ACCENT: '#d99a5f', CARD_BG: '#120c07', BORDER: '#2e2114', BG: '#0a0705', TEXT: '#f2dfc2', NAV_BTN: '#1c130b', STAR: '217,154,95', ICON: '#ffffff', ONACC: '#0a0a0a', HOV: '#2a2a2a' },
    red:       { ACCENT: '#d67f6d', CARD_BG: '#150c0a', BORDER: '#332019', BG: '#0d0807', TEXT: '#f3e2d8', NAV_BTN: '#211210', STAR: '214,127,109', ICON: '#ffffff', ONACC: '#0a0a0a', HOV: '#2a2a2a' },
    green:     { ACCENT: '#a3b18a', CARD_BG: '#0c110b', BORDER: '#232b20', BG: '#070a07', TEXT: '#e3e8d8', NAV_BTN: '#151a13', STAR: '163,177,138', ICON: '#ffffff', ONACC: '#0a0a0a', HOV: '#2a2a2a' },
    white:     { ACCENT: '#2f5d8a', CARD_BG: '#ffffff', BORDER: '#e3ddd0', BG: '#f4f1ea', TEXT: '#211d16', NAV_BTN: '#ebe6da', STAR: '120,110,95', ICON: '#211d16', ONACC: '#ffffff', HOV: '#e7e1d3' },
    ocean:     { ACCENT: '#5aa9e6', CARD_BG: '#0a1218', BORDER: '#1e3a4d', BG: '#060b10', TEXT: '#d8ecf5', NAV_BTN: '#10202c', STAR: '140,190,220', ICON: '#ffffff', ONACC: '#06121a', HOV: '#1a2f3d' },
    miami:     { ACCENT: '#e9a088', CARD_BG: '#291a24', BORDER: '#694252', BG: '#171017', TEXT: '#f7e7ea', NAV_BTN: '#392330', STAR: '233,160,136', ICON: '#ffffff', ONACC: '#24131d', HOV: '#4b3140' },
    sunset:    { ACCENT: '#edbd83', CARD_BG: '#2a1b15', BORDER: '#5c3d2e', BG: '#160f0b', TEXT: '#f7e8d5', NAV_BTN: '#3b281e', STAR: '223,154,101', ICON: '#ffffff', ONACC: '#2a1910', HOV: '#51382a' },
    aurora:    { ACCENT: '#d1aed5', CARD_BG: '#261f2b', BORDER: '#5a4a60', BG: '#151119', TEXT: '#f1e9f3', NAV_BTN: '#362a3b', STAR: '205,164,207', ICON: '#f7f0fa', ONACC: '#261b2a', HOV: '#46384d' }
  };
  let ACCENT  = '#ffffff';
  let CARD_BG = '#111111';
  let BORDER  = '#2b2b2b';
  let BG      = '#000000';
  let TEXT    = '#ffffff';
  let NAV_BTN = '#161616';
  let STAR = '255,255,255';
  let ICON = '#ffffff';
  let ONACC = '#0a0a0a';
  let HOV = '#2a2a2a';

  let canvas, ctx, stars = [], raf;

  function buildCanvas() {
    if (document.getElementById('tros-stars')) return;
    canvas = document.createElement('canvas');
    canvas.id = 'tros-stars';
    canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:0;';
    document.body.prepend(canvas);
    ctx = canvas.getContext('2d');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
  }

  function resizeCanvas() {
    if (!canvas) return;
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function initStars() {
    stars = Array.from({ length: 70 }, () => ({
      x:  Math.random() * canvas.width,
      y:  Math.random() * canvas.height,
      r:  Math.random() * 1.4 + 0.3,
      a:  Math.random(),
      da: (Math.random() * 0.007 + 0.002) * (Math.random() > .5 ? 1 : -1)
    }));
  }

  function tickStars() {
    if (!ctx) return;
    if (document.hidden) {
      raf = requestAnimationFrame(tickStars);
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    stars.forEach(s => {
      s.a += s.da;
      if (s.a >= 1 || s.a <= 0.05) s.da *= -1;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${STAR},${s.a})`;
      ctx.fill();
    });
    raf = requestAnimationFrame(tickStars);
  }

  function startStars() {
    buildCanvas();
    resizeCanvas();
    initStars();
    cancelAnimationFrame(raf);
    tickStars();
  }

  function stopStars() {
    cancelAnimationFrame(raf);
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    const el = document.getElementById('tros-stars');
    if (el) el.remove();
    canvas = null; ctx = null;
  }

  function injectCSS() {
    if (document.getElementById('tros-dark-style')) return;
    const s = document.createElement('style');
    s.id = 'tros-dark-style';
    s.textContent = `
      html, body {
        background-color: ${BG} !important;
      }
      html {
        height: 100%;
      }
      body {
        min-height: 100vh;
      }
      html.has-wallpaper #settings-shell {
        background: transparent !important;
        background-color: transparent !important;
      }
      html.has-wallpaper body {
        background-color: transparent !important;
      }
      html.has-wallpaper [class*="rounded-2xl"] {
        background-color: color-mix(in srgb, ${CARD_BG} 62%, transparent) !important;
      }
      html.has-wallpaper p, html.has-wallpaper span, html.has-wallpaper h1,
      html.has-wallpaper h2, html.has-wallpaper h3, html.has-wallpaper div {
        text-shadow: 0 1px 4px rgba(0,0,0,.55);
      }
      html.has-wallpaper input, html.has-wallpaper textarea,
      html.has-wallpaper button {
        text-shadow: none;
      }
      html[data-tros-theme="ocean"] .sidebar-title,
      html[data-tros-theme="ocean"] h1.hop {
        color: #2b6cb0 !important;
      }
      :root {
        --tros-accent: ${ACCENT};
        --tros-onacc: ${ONACC};
        --tros-text: ${TEXT};
        --tros-card: ${CARD_BG};
        --tros-border: ${BORDER};
        --tros-bg: ${BG};
      }

      [style*="background-color: rgb(132"],
      [style*="background-color:#84"],
      [style*="background-color: #84"],
      [style*="menuBackground"],
      [style*="gameBackground"] {
        background-color: ${BG} !important;
      }

      #tros, #tros > * {
        background-color: ${CARD_BG} !important;
      }

      [class*="bg-blue"]     { background-color: ${CARD_BG} !important; }
      [class*="border-blue"] { border-color: ${BORDER} !important; }
      [class*="text-blue"]   { color: ${ACCENT} !important; }

      h1, h2, h3, h4, h5, h6 { color: ${TEXT} !important; }
      p:not(.tros-sys)       { color: ${TEXT} !important; }
      span:not(.tros-sys)    { color: ${TEXT} !important; }
      label, a                { color: ${TEXT} !important; }

      button[class*="bg-blue"]              { background-color: ${NAV_BTN} !important; }
      button[class*="hover:bg-blue"]:hover  { background-color: ${HOV} !important; }

      svg { color: ${ICON} !important; stroke: ${ICON} !important; }
      svg[stroke]:not([stroke="none"]), svg [stroke]:not([stroke="none"]),
      svg path:not([stroke="none"]), svg line:not([stroke="none"]),
      svg rect:not([stroke="none"]), svg circle:not([stroke="none"]) { stroke: ${ICON} !important; }
      svg[fill]:not([fill="none"]), svg [fill]:not([fill="none"]) { fill: ${ICON} !important; }

      .nav-btn::after {
        background:    ${CARD_BG} !important;
        border-color:  ${BORDER}  !important;
        color:         ${TEXT}    !important;
      }

      input {
        background-color: ${CARD_BG} !important;
        border-color:     ${BORDER}  !important;
        color:            ${TEXT}    !important;
      }
      input::placeholder { color: #737373 !important; }
      input:focus {
        border-color: ${ACCENT} !important;
        box-shadow: 0 0 0 2px rgba(255,255,255,.15) !important;
        outline: none !important;
      }

      div[onclick] {
        background-color: ${CARD_BG} !important;
        border-color:     ${BORDER}  !important;
      }

      [class*="rounded-2xl"] {
        background-color: ${CARD_BG} !important;
        border-color:     ${BORDER}  !important;
      }

      iframe {
        background:   ${BG} !important;
        color-scheme: dark;
      }

      #theme-btn, div.fixed.bottom-3.left-3 {
        background-color: ${CARD_BG} !important;
        border-color:     ${BORDER}  !important;
      }

      #tros-overlay { background: rgba(0,0,0,.85) !important; }

      #tros-modal {
        background:   ${CARD_BG} !important;
        border-color: ${BORDER}  !important;
      }

      #tros-modal-title    { color: ${TEXT}   !important; }
      #tros-modal-meta     { color: ${ACCENT} !important; }
      #tros-modal-overview { color: ${TEXT}   !important; }
      #tros-modal-poster   { border-color: ${BORDER} !important; }

      #tros-modal-close {
        background:   rgba(255,255,255,.08) !important;
        border-color: rgba(255,255,255,.15) !important;
        color:        ${ACCENT} !important;
      }
      #tros-modal-close:hover { background: rgba(255,255,255,.18) !important; }

      .tros-sel {
        background:   ${CARD_BG} !important;
        border-color: ${BORDER}  !important;
        color:        ${TEXT}    !important;
      }
      .tros-sel option { background: ${CARD_BG} !important; color: ${TEXT} !important; }

      #tros-watch-btn {
        background: ${ACCENT} !important;
        color: ${ONACC} !important;
      }
      #tros-watch-btn:hover { filter: brightness(1.12); }

      #tros-season-loading { color: ${ACCENT} !important; }

      /* player bar */
      #tros-player-bar { background: linear-gradient(180deg,rgba(0,0,0,.95) 0%,transparent 100%) !important; }
      #tros-player-back {
        background:   rgba(255,255,255,.1) !important;
        border-color: rgba(255,255,255,.2) !important;
        color: #fff !important;
      }
      #tros-player-title { color: #fff !important; }
      #tros-player-sub   { color: rgba(255,255,255,.6) !important; }

      /* tros card rows */
      .tros-card {
        background:   ${CARD_BG} !important;
        border-color: ${BORDER}  !important;
      }
      .tros-card:hover { background: ${NAV_BTN} !important; }
      .tros-card p     { color: ${TEXT} !important; }

      /* lumin game browser (n1chtesting2) — kill the blue */
      .lumi-wrapper { background: ${BG} !important; color: ${TEXT} !important; }
      .lumi-search, .lumi-source-select {
        background: ${CARD_BG} !important;
        border-color: ${BORDER} !important;
        color: ${TEXT} !important;
      }
      .lumi-btn, .lumi-random-btn {
        background: ${NAV_BTN} !important;
        color: ${TEXT} !important;
      }
      .lumi-btn:hover, .lumi-random-btn:hover { background: ${BORDER} !important; }
      .lumi-game-card { background: ${CARD_BG} !important; border-color: ${BORDER} !important; }
      .lumi-page-btn {
        background: ${NAV_BTN} !important;
        color: ${TEXT} !important;
        border-color: ${BORDER} !important;
      }
      .lumi-page-btn.active {
        background: ${ACCENT} !important;
        color: ${ONACC} !important;
        border-color: ${ACCENT} !important;
      }
      .lumi-game-view { background: ${BG} !important; border-color: ${BORDER} !important; }
      .lumi-back-btn, .lumi-download-btn, .lumi-aboutblank-btn, .lumi-fullscreen-btn {
        background: ${NAV_BTN} !important;
        color: ${TEXT} !important;
      }
      .lumi-back-btn:hover, .lumi-download-btn:hover, .lumi-aboutblank-btn:hover, .lumi-fullscreen-btn:hover {
        background: ${BORDER} !important;
      }
    `;
    document.head.appendChild(s);
  }

  function removeCSS() {
    const el = document.getElementById('tros-dark-style');
    if (el) el.remove();
  }

  function patchLumi() {
    if (!document.getElementById('tros')) return;
    const observer = new MutationObserver(() => {
      document.querySelectorAll('#tros, #tros *').forEach(el => {
        const bg = el.style.backgroundColor;
        if (bg && (bg.includes('132') || bg.includes('84BF') || bg.includes('4A9B'))) {
          el.style.backgroundColor = CARD_BG;
        }
        const bc = el.style.borderColor;
        if (bc && (bc.includes('4A9B') || bc.includes('84BF'))) {
          el.style.borderColor = BORDER;
        }
        const col = el.style.color;
        if (col && col.includes('216,201,178')) {
          el.style.color = TEXT;
        }
      });
    });
    observer.observe(document.getElementById('tros'), { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  }

  function markSysElements() {
    document.querySelectorAll('p.fixed').forEach(el => el.classList.add('tros-sys'));
  }

  function postToFrame(f, dark, name) {
    try { f.contentWindow.postMessage({ trosTheme: dark ? 'dark' : 'ocean', trosThemeName: name || (dark ? 'dark' : 'ocean') }, '*'); }
    catch (_) {}
  }

  function notifyIframes(dark, name) {
    document.querySelectorAll('iframe').forEach(f => postToFrame(f, dark, name));
  }

  function watchIframes() {
    document.querySelectorAll('iframe').forEach(f => {
      f.removeEventListener('load', f._trosLoad);
      f._trosLoad = () => {
        const nm = getTheme();
        postToFrame(f, nm !== 'light', nm);
      };
      f.addEventListener('load', f._trosLoad);
    });
  }

  function hookChangePage() {
    const orig = window.changePage;
    window.changePage = function (page) {
      if (orig) orig(page);
      setTimeout(watchIframes, 50);
    };
  }

  function getTheme() {
    try {
      const v = localStorage.getItem(THEME_KEY);
      if (v === 'light') return 'ocean';
      if (THEMES[v]) return v;
      if (localStorage.getItem(STORAGE_KEY) === '0') return 'ocean';
    } catch (e) {}
    return 'dark';
  }
  function setTheme(name) {
    if (!THEMES[name]) name = 'dark';
    try {
      localStorage.setItem(THEME_KEY, name);
      localStorage.setItem(STORAGE_KEY, '1');
    } catch (e) {}
    applyTheme(name);
  }
  function applyTheme(name) {
    if (!THEMES[name]) name = 'dark';
    try { document.documentElement.dataset.trosTheme = name; } catch (e) {}
    const P = THEMES[name];
    ACCENT = P.ACCENT; CARD_BG = P.CARD_BG; BORDER = P.BORDER;
    BG = P.BG; TEXT = P.TEXT; NAV_BTN = P.NAV_BTN; STAR = P.STAR;
    ICON = P.ICON; ONACC = P.ONACC; HOV = P.HOV;
    removeCSS();
    injectCSS();
    applyWallpaper();
    startStars();
    markSysElements();
    notifyIframes(true, name);
    watchIframes();
    patchLumi();
  }
  function applyDark() { applyTheme('dark'); }
  function applyLight() { applyTheme('ocean'); }

  window.trosToggleTheme = function () {
    const cur = getTheme();
    if (cur === 'ocean') {
      let back = 'dark';
      try { back = localStorage.getItem('tros-theme-dark') || 'dark'; } catch (e) {}
      setTheme(THEMES[back] ? back : 'dark');
    } else {
      try { localStorage.setItem('tros-theme-dark', cur); } catch (e) {}
      setTheme('ocean');
    }
  };
  window.trosSetTheme = function (name) { setTheme(name); };
  window.trosGetTheme = function () { return getTheme(); };
  window.trosSetWallpaper = function (d) { setWallpaper(d); };
  window.trosGetWallpaper = function () { return getWallpaper(); };
  window.trosClearWallpaper = function () { setWallpaper(null); };

  window.addEventListener('message', e => {
    if (!e.data || !e.data.trosTheme) return;
    const named = e.data.trosThemeName;
    if (named && THEMES[named]) { setTheme(named); return; }
    setTheme(e.data.trosTheme === 'dark' ? 'dark' : 'ocean');
  });

  window.addEventListener('storage', e => {
    if (e.key === WALL_KEY) { applyWallpaper(); return; }
    if (e.key === THEME_KEY) { applyTheme(e.newValue); return; }
    if (e.key !== STORAGE_KEY) return;
    try { if (localStorage.getItem(THEME_KEY)) return; } catch (e2) {}
    e.newValue === '1' ? applyDark() : applyLight();
  });

  function init() {
    markSysElements();
    watchIframes();
    hookChangePage();
    applyTheme(getTheme());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
