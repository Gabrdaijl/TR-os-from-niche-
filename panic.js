(function () {
  if (window.__trosPanicInstalled) return;
  window.__trosPanicInstalled = true;
  function handler(e) {
    var cfg = null;
    try { cfg = JSON.parse(localStorage.getItem('tros-panic') || 'null'); } catch (err) {}
    if (!cfg || !cfg.key || !cfg.url) return;
    try { if (e.target && e.target.closest && e.target.closest('input, textarea, [contenteditable="true"]')) return; } catch (e2) {}
    if ((e.key || '').toLowerCase() !== String(cfg.key).toLowerCase()) return;
    if (!!e.ctrlKey !== !!cfg.ctrl) return;
    if (!!e.shiftKey !== !!cfg.shift) return;
    if (!!e.altKey !== !!cfg.alt) return;
    if (!!e.metaKey !== !!cfg.meta) return;
    try { e.preventDefault(); } catch (e3) {}
    try { top.location.href = cfg.url; return; } catch (e4) {}
    try { parent.postMessage({ __trosPanic: cfg.url }, '*'); } catch (e5) {}
    try { location.href = cfg.url; } catch (e6) {}
  }
  if (document.addEventListener) document.addEventListener('keydown', handler, true);
})();
