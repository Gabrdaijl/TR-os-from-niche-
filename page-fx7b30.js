const FX_BOOT = "#gameGrid > div, .lumi-game-card, .game-card, [data-fx]";
const FX_LIVE = FX_BOOT + ", #chat-feed > div, #chat-history > *";
let fxN = 0;

function fxAdd(el, stagger) {
  if (!(el instanceof Element)) return;
  if (el.classList.contains("fx-item")) return;
  el.classList.add("fx-item");
  if (stagger) {
    el.style.setProperty("--fx-d", Math.min(fxN * 30, 600) + "ms");
    fxN++;
  }
}

function fxMatch(el) {
  try {
    return el.matches(FX_LIVE);
  } catch (e) {
    return false;
  }
}

function fxBoot() {
  document.documentElement.classList.add("fx-ready");
  fxN = 0;
  document.querySelectorAll(FX_BOOT).forEach((el) => fxAdd(el, true));
  const obs = new MutationObserver((muts) => {
    muts.forEach((m) => {
      m.addedNodes.forEach((n) => {
        if (!(n instanceof Element)) return;
        if (fxMatch(n)) fxAdd(n, false);
        try {
          n.querySelectorAll(FX_BOOT).forEach((c) => fxAdd(c, false));
        } catch (e) {}
      });
    });
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", fxBoot);
} else {
  fxBoot();
}

document.addEventListener("selectstart", (e) => {
  try {
    const t = e.target;
    if (t && t.closest && t.closest("input, textarea, [contenteditable=\"true\"]")) return;
  } catch (err) {}
  e.preventDefault();
}, true);
document.addEventListener("keydown", (e) => {
  const k = (e.key || "").toLowerCase();
  if (e.key === "F12") e.preventDefault();
  else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (k === "i" || k === "j" || k === "c" || k === "u" || k === "k")) e.preventDefault();
  else if ((e.ctrlKey || e.metaKey) && k === "u") e.preventDefault();
  else if (e.metaKey && e.altKey && (k === "i" || k === "j" || k === "c" || k === "u")) e.preventDefault();
});
document.addEventListener("contextmenu", (e) => {
  try {
    const t = e.target;
    if (t && t.closest && t.closest("input, textarea")) return;
  } catch (err) {}
  e.preventDefault();
}, true);
