(function () {
  'use strict';
  const hosts = ['doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'adnxs.com', 'adsterra.com', 'profitablecpmrate.com', 'profitableratecpm.com', 'highperformanceformat.com', 'effectivegatecpm.com', 'popads.net', 'popcash.net', 'onclicka.com', 'exoclick.com', 'adskeeper.com', 'mgid.com', 'amazon-adsystem.com'];
  function blocked(value) {
    try { const h = new URL(String(value), document.baseURI).hostname; return hosts.some(x => h === x || h.endsWith('.' + x)); } catch { return false; }
  }
  const nativeFetch = window.fetch;
  window.fetch = function (input, options) {
    if (blocked(input && input.url || input)) return Promise.resolve(new Response(null, { status: 204 }));
    return nativeFetch.call(this, input, options);
  };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...args) { return open.call(this, method, blocked(url) ? 'data:text/plain,' : url, ...args); };
  // Popup ads often open a blank tab first and navigate it later, so a host
  // allowlist alone misses them. These scripts run in game/movie documents;
  // normal playback stays in the iframe and does not need window.open.
  const denyPopup = function () { return null; };
  function denyPopups(target) {
    try {
      Object.defineProperty(target, 'open', {
        configurable: false,
        enumerable: true,
        writable: false,
        value: denyPopup
      });
    } catch (_) {
      try { target.open = denyPopup; } catch (_) {}
    }
  }
  // Proxied pages can share TR-os's origin. Protect accessible app ancestors
  // as well, so parent.open and top.open cannot sidestep the frame's guard.
  let popupScope = window;
  for (let depth = 0; depth < 8; depth++) {
    denyPopups(popupScope);
    try {
      const parent = popupScope.parent;
      if (!parent || parent === popupScope || !parent.document?.documentElement) break;
      popupScope = parent;
    } catch (_) { break; }
  }
  function popupTarget(value) {
    const target = String(value || '').trim().toLowerCase();
    return !!target && !['_self', '_parent', '_top'].includes(target);
  }
  function blockTargetedNavigation(event) {
    const link = event.target.closest && event.target.closest('a[target],area[target]');
    const submitter = event.target.closest && event.target.closest('[formtarget]');
    const target = link?.getAttribute('target') || submitter?.getAttribute('formtarget');
    if (!popupTarget(target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  document.addEventListener('click', blockTargetedNavigation, true);
  document.addEventListener('auxclick', blockTargetedNavigation, true);
  document.addEventListener('submit', event => {
    if (!popupTarget(event.target?.getAttribute?.('target'))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  const adMarker = 'ins.adsbygoogle,[id="ad-container"],[id="ads-container"],[id="preroll-ad"],[class~="ad-container"]';
  const selector = 'script[src],iframe[src],img[src],link[href],' + adMarker;
  function clean(root) {
    const nodes = root.querySelectorAll ? [...root.querySelectorAll(selector)] : [];
    if (root.matches && root.matches(selector)) nodes.push(root);
    for (const el of nodes) {
      if (blocked(el.getAttribute('src') || el.getAttribute('href')) || el.matches(adMarker)) el.remove();
    }
  }
  new MutationObserver(records => { for (const record of records) { if (record.type === 'attributes') clean(record.target); else for (const node of record.addedNodes) clean(node); } }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'href'] });
  document.addEventListener('click', event => {
    const link = event.target.closest && event.target.closest('a[href]');
    if (link && blocked(link.href)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  clean(document);
})();

