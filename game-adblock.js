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
  window.open = () => null;
  const selector = 'script[src],iframe[src],img[src],link[href],ins.adsbygoogle,[id="ad-container"],[id="ads-container"],[id="preroll-ad"],[class~="ad-container"],[class~="ad-overlay"]';
  function clean(root) {
    const nodes = root.querySelectorAll ? [...root.querySelectorAll(selector)] : [];
    if (root.matches && root.matches(selector)) nodes.push(root);
    for (const el of nodes) {
      if (blocked(el.getAttribute('src') || el.getAttribute('href')) || el.matches('ins.adsbygoogle,[id="ad-container"],[id="ads-container"],[id="preroll-ad"],[class~="ad-container"],[class~="ad-overlay"]')) el.remove();
    }
  }
  new MutationObserver(records => { for (const record of records) { if (record.type === 'attributes') clean(record.target); else for (const node of record.addedNodes) clean(node); } }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'href'] });
  document.addEventListener('click', event => {
    const link = event.target.closest && event.target.closest('a[href]');
    if (link && (blocked(link.href) || link.target === '_blank')) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  clean(document);
})();

