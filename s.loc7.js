const WISP_ROUTES = {
  vps: "/wisp-vps/",
  paloalto: "/wisp-paloalto/",
  boston: "/wisp-boston/",
  milan: "/wisp-milan/",
  "mullvad-us": "/wisp-mullvad-us/",
  "mullvad-eu": "/wisp-mullvad-eu/",
  "mullvad-se": "/wisp-mullvad-se/",
  mullvad: "/wisp-mullvad/"
};
var RELAY_RE = /^[a-z]{2}-[a-z]{2,4}-wg-[0-9]+\.conf$/;
var RESI_ALIAS = { paloalto: "mullvad-us", boston: "mullvad-us", milan: "mullvad-eu" };
function mvEnabled() {
  if (window.TR_OS.vpnConfigured === false) return false;
  try { return localStorage.getItem("tros-mullvad") !== "0"; }
  catch (e) { return true; }
}
function trosLoc() {
  try { return localStorage.getItem("tros-loc") || "mullvad-eu"; }
  catch (e) { return "mullvad-eu"; }
}
function wispUrl() {
  let loc = trosLoc();
  if (RESI_ALIAS[loc]) { loc = RESI_ALIAS[loc]; }
  if (!mvEnabled()) { return window.TR_OS.wispUrl(WISP_ROUTES.vps); }
  if (loc === "vps") { return window.TR_OS.wispUrl(WISP_ROUTES.vps); }
  if (RELAY_RE.test(loc)) { return window.TR_OS.wispUrl(WISP_ROUTES.mullvad); }
  if (WISP_ROUTES[loc]) { return window.TR_OS.wispUrl(WISP_ROUTES[loc]); }
  return window.TR_OS.wispUrl(WISP_ROUTES.mullvad);
}
let __bareConn = null;
window.trosSetLocation = async function (loc) {
  if (!WISP_ROUTES[loc] && !RELAY_RE.test(loc)) return false;
  try { localStorage.setItem("tros-loc", loc); } catch (e) {}
  try {
    if (__bareConn) await __bareConn.setTransport(window.TR_OS.assetUrl("epoxy/index.mjs"), [{ wisp: wispUrl() }]);
  } catch (e) { return false; }
  try {
    const fr = document.getElementById("_pframe");
    if (fr && hist[hidx]) loadUrl(hist[hidx], false);
  } catch (e) {}
  try { updateLocLabel(); } catch (e) {}
  return true;
};
window.trosGetLocation = function () { return trosLoc(); };

const LOC_META = {
  vps: { flag: "🇺🇸", name: "VPS" },
  paloalto: { flag: "🇺🇸", name: "Palo Alto" },
  boston: { flag: "🇺🇸", name: "Boston" },
  milan: { flag: "🇮🇹", name: "Milan" },
  "mullvad-us": { flag: "🇺🇸", name: "Mullvad US" },
  "mullvad-eu": { flag: "🇪🇺", name: "Mullvad EU" },
  "mullvad-se": { flag: "🇸🇪", name: "Mullvad SE" },
  mullvad: { flag: "🔒", name: "Mullvad" }
};
let locCheckSeq = 0;
function updateLocLabel() {
  const el = document.getElementById("_ploc");
  if (!el) return;
  const rawLoc = trosLoc();
  const loc = (WISP_ROUTES[rawLoc] || RELAY_RE.test(rawLoc)) ? rawLoc : "vps";
  let meta = LOC_META[loc];
  if (!meta && RELAY_RE.test(loc)) { meta = { flag: "🔒", name: loc.replace(".conf", "") }; }
  meta = meta || LOC_META.vps;
  el.textContent = meta.flag + " " + meta.name + " …";
  const seq = ++locCheckSeq;
  let ws = null, done = false;
  const finish = (ok) => {
    if (done) return; done = true;
    try { ws.close(); } catch (e) {}
    if (seq !== locCheckSeq) return;
    const cur = document.getElementById("_ploc");
    if (cur) cur.textContent = meta.flag + " " + meta.name + (ok ? " ✓" : " X");
  };
  try {
    ws = new WebSocket(wispUrl());
  } catch (e) { finish(false); return; }
  ws.addEventListener("open", () => finish(true));
  ws.addEventListener("error", () => finish(false));
  setTimeout(() => finish(false), 8000);
}

let __sj = null;
let __sjReady = false;
const hist = [];
let hidx = -1;

const LIGHT = { bar:'#93c5fd', barBorder:'#60a5fa', btn:'#60a5fa', btnHover:'#3b82f6', input:'#bfdbfe', inputBorder:'#60a5fa', inputText:'#0a4f98', stroke:'rgb(10,79,152)' };
const DARK = { bar:'#111111', barBorder:'#2a2a2a', btn:'#1a1a1a', btnHover:'#2a2a2a', input:'#0a0a0a', inputBorder:'#2a2a2a', inputText:'#e5e5e5', stroke:'#fff' };
function sIsDark() { try { return localStorage.getItem('tros-dark') !== '0'; } catch (e) { return true; } }
function paintBar() {
  const dark = sIsDark();
  const C = dark ? DARK : LIGHT;
  const bar = document.getElementById('_pbar');
  if (bar) { bar.style.background = C.bar; bar.style.borderColor = C.barBorder; }
  ['_ph','_pb','_pf','_pr','_pt'].forEach(function (id) {
    const b = document.getElementById(id);
    if (b) b.style.background = C.btn;
  });
  const tgl = document.getElementById('_pt');
  if (tgl) { tgl.style.color = dark ? '#fff' : '#0a4f98'; tgl.style.borderColor = C.barBorder; }
  const ploc = document.getElementById('_ploc');
  if (ploc) ploc.style.color = dark ? '#e5e5e5' : '#0a4f98';
  const input = document.getElementById('_pi');
  if (input) { input.style.background = C.input; input.style.borderColor = C.inputBorder; input.style.color = C.inputText; }
  document.querySelectorAll('#_pbar svg').forEach(function (svg) {
    svg.setAttribute('stroke', C.stroke);
    svg.querySelectorAll('path, polyline, line, rect, circle').forEach(function (el) { el.setAttribute('stroke', C.stroke); });
  });
}
function hookTheme() {
  try {
    if (window._sThemeHooked) return;
    window._sThemeHooked = true;
    window.addEventListener('storage', function (e) { if (e.key === 'tros-dark') paintBar(); });
    window.addEventListener('message', function (e) { if (e.data && e.data.trosTheme) setTimeout(paintBar, 0); });
    var wrap = function () {
      if (window._sToggleWrapped) return;
      if (typeof window.trosToggleTheme !== 'function') return;
      window._sToggleWrapped = true;
      var o = window.trosToggleTheme;
      window.trosToggleTheme = function () { var r = o.apply(this, arguments); setTimeout(paintBar, 0); return r; };
    };
    wrap();
    var i = 0;
    var wait = setInterval(function () { wrap(); if (window._sToggleWrapped || ++i > 50) clearInterval(wait); }, 100);
    setInterval(function () {
      var d = sIsDark() ? '1' : '0';
      if (window._sLastDark !== d) { window._sLastDark = d; paintBar(); }
    }, 1000);
  } catch (e) {}
}

async function initScramjet() {
  const { ScramjetController } = $scramjetLoadController();
  const client = new ScramjetController({
    files: {
      wasm: window.TR_OS.assetUrl("scram/scramjet.wasm.wasm"),
      all: window.TR_OS.assetUrl("scram/scramjet.all.js"),
      sync: window.TR_OS.assetUrl("scram/scramjet.sync.js"),
    },
  });
  await client.init();
  await window.TR_OS.ensureServiceWorker();

  const conn = new BareMux.BareMuxConnection(window.TR_OS.assetUrl("baremux/worker.js"));
  __bareConn = conn;

  // Just set the transport directly. Do NOT open a test WebSocket!
  try {
    await conn.setTransport(window.TR_OS.assetUrl("epoxy/index.mjs"), [{ wisp: wispUrl() }]);
  } catch (err) {
    console.error("Failed to set Epoxy transport:", err);
  }

  __sj = client;
  __sjReady = true;
}

function buildUrl(raw) {
  raw = raw.trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/\.\w{2,}/.test(raw) && !raw.includes(" ")) return "https://" + raw;
  return "https://www.google.com/search?q=" + encodeURIComponent(raw);
}

function updateNav() {
  const pb = document.getElementById("_pb");
  const pf = document.getElementById("_pf");
  if (!pb || !pf) return;
  pb.style.opacity = hidx <= 0 ? "0.35" : "1";
  pb.style.pointerEvents = hidx <= 0 ? "none" : "auto";
  pf.style.opacity = hidx >= hist.length - 1 ? "0.35" : "1";
  pf.style.pointerEvents = hidx >= hist.length - 1 ? "none" : "auto";
}

let barCollapsed = false;
function setCollapsed(c) {
  barCollapsed = !!c;
  const barEl = document.getElementById("_pbar");
  const t = document.getElementById("_pt");
  if (!barEl || !t) return;
  t.textContent = barCollapsed ? "▲" : "▼";
  barEl.style.maxHeight = barCollapsed ? "0px" : "70px";
  barEl.style.opacity = barCollapsed ? "0" : "1";
  barEl.style.borderWidth = barCollapsed ? "0" : "2px";
}

function loadUrl(url, push = true) {
  if (!__sjReady) return;
  if (push) {
    hist.splice(hidx + 1);
    hist.push(url);
    hidx = hist.length - 1;
  }
  document.getElementById("_pframe").src = __sj.encodeUrl(url);
  document.getElementById("_pi").value = url;
  document.getElementById("_pframe").style.display = "block";
  document.getElementById("_pwrap").style.display = "flex";
  setCollapsed(false);
  updateNav();
}

function goHome() {
  document.getElementById("_pframe").style.display = "none";
  document.getElementById("_pwrap").style.display = "none";
  document.getElementById("_pframe").src = "";
  document.getElementById("_pi").value = "";
  hist.length = 0;
  hidx = -1;
  updateNav();
}

function navigate(raw) {
  if (!raw.trim()) return;
  loadUrl(buildUrl(raw));
}

function mkBtn(id, svg) {
  const btn = document.createElement("button");
  btn.id = id;
  btn.innerHTML = svg;
  btn.style.cssText = "background:#60a5fa;padding:8px;border:none;border-radius:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background .15s;";
  btn.onmouseover = () => btn.style.background = (sIsDark() ? DARK.btnHover : LIGHT.btnHover);
  btn.onmouseout  = () => btn.style.background = (sIsDark() ? DARK.btn : LIGHT.btn);
  return btn;
}

function injectAll() {
  const frame = document.createElement("iframe");
  frame.id = "_pframe";
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups allow-pointer-lock allow-modals");
  frame.style.cssText = "display:none;position:fixed;inset:0;width:100%;height:100%;border:none;z-index:40;background:white;";
  document.body.appendChild(frame);

  const bar = document.createElement("div");
  bar.id = "_pbar";
  bar.style.cssText = "display:flex;width:fit-content;max-width:520px;height:60px;max-height:70px;background:#93c5fd;border:2px solid #60a5fa;border-radius:12px;align-items:center;gap:8px;padding:0 12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.15);transition:max-height .25s ease,opacity .25s ease;";

  const wrap = document.createElement("div");
  wrap.id = "_pwrap";
  wrap.style.cssText = "display:none;position:fixed;bottom:20px;left:0;right:0;margin:0 auto;width:fit-content;max-width:520px;z-index:50;flex-direction:column;align-items:center;";

  const svgHome = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgb(10,79,152)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
  const svgBack = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgb(10,79,152)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>`;
  const svgFwd  = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgb(10,79,152)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>`;
  const svgRld  = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgb(10,79,152)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;

  const home   = mkBtn("_ph", svgHome);
  const back   = mkBtn("_pb", svgBack);
  const fwd    = mkBtn("_pf", svgFwd);
  const reload = mkBtn("_pr", svgRld);

  back.style.opacity = "0.35";
  back.style.pointerEvents = "none";
  fwd.style.opacity = "0.35";
  fwd.style.pointerEvents = "none";

  const input = document.createElement("input");
  input.id = "_pi";
  input.type = "text";
  input.placeholder = "Search the web....";
  input.className = "font-sans";
  input.style.cssText = "width:300px;height:28px;background:#bfdbfe;border:1px solid #60a5fa;border-radius:999px;text-align:center;outline:none;padding:0 12px;transition:width .3s;font-family:inherit;";
  input.onfocus = () => input.style.width = "340px";
  input.onblur  = () => input.style.width = "300px";

  home.addEventListener("click", goHome);

  back.addEventListener("click", () => {
    const fr = document.getElementById("_pframe");
    try {
      if (fr.contentWindow) { fr.contentWindow.history.back(); return; }
    } catch {}
    try {
      if (!__sjReady) return;
      if (hidx > 0) {
        hidx--;
        fr.src = __sj.encodeUrl(hist[hidx]);
        document.getElementById("_pi").value = hist[hidx];
        setCollapsed(false);
        updateNav();
      }
    } catch {}
  });

  fwd.addEventListener("click", () => {
    const fr = document.getElementById("_pframe");
    try {
      if (fr.contentWindow) { fr.contentWindow.history.forward(); return; }
    } catch {}
    try {
      if (!__sjReady) return;
      if (hidx < hist.length - 1) {
        hidx++;
        fr.src = __sj.encodeUrl(hist[hidx]);
        document.getElementById("_pi").value = hist[hidx];
        setCollapsed(false);
        updateNav();
      }
    } catch {}
  });

  reload.addEventListener("click", () => {
    const fr = document.getElementById("_pframe");
    try {
      if (fr.contentWindow) { fr.contentWindow.location.reload(); return; }
    } catch {}
    try {
      if (hist[hidx]) fr.src = __sj.encodeUrl(hist[hidx]);
      else if (fr.src) fr.src = fr.src;
    } catch {}
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && input.value.trim()) navigate(input.value);
  });

  const lloc = document.createElement("span");
  lloc.id = "_ploc";
  lloc.style.cssText = "font-size:12px;white-space:nowrap;flex-shrink:0;min-width:86px;font-family:inherit;";
  bar.appendChild(lloc);
  bar.appendChild(home);
  bar.appendChild(back);
  bar.appendChild(fwd);
  bar.appendChild(reload);
  bar.appendChild(input);
  wrap.appendChild(bar);
  document.body.appendChild(wrap);

  const toggle = document.createElement("button");
  toggle.id = "_pt";
  toggle.title = "Hide/show bar";
  toggle.textContent = "▼";
  toggle.style.cssText = "width:46px;height:20px;background:#60a5fa;border:2px solid #60a5fa;border-bottom:none;border-radius:8px 8px 0 0;color:#fff;font-size:11px;line-height:16px;cursor:pointer;padding:0;margin-bottom:-2px;transition:background .15s;";
  toggle.addEventListener("click", () => setCollapsed(!barCollapsed));
  wrap.insertBefore(toggle, bar);

  frame.addEventListener("load", () => {
    try {
      let href = "";
      try { href = frame.contentWindow.location.href; } catch {}
      if (!href || href === "about:blank") href = frame.getAttribute("src") || frame.src;
      if (!href || href === "about:blank") return;
      if (!__sj || !__sjReady || typeof __sj.decodeUrl !== "function") return;
      const decoded = __sj.decodeUrl(href);
      if (!decoded) return;
      const at = hist.indexOf(decoded);
      if (at >= 0) hidx = at;
      else {
        hist.splice(hidx + 1);
        hist.push(decoded);
        hidx = hist.length - 1;
      }
      const pi = document.getElementById("_pi");
      if (pi && document.activeElement !== pi) pi.value = decoded;
      updateNav();
    } catch {}
  });

  const existing = document.querySelector("input[type=text]");
  if (existing) {
    existing.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.value.trim()) navigate(e.target.value);
    });
  }

  window._sLastDark = sIsDark() ? '1' : '0';
  paintBar();
  updateLocLabel();
  hookTheme();
}

initScramjet();
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", injectAll);
else injectAll();
