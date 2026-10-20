(function () {
  'use strict';
  // Some embedded players refuse to run when they can see the iframe's
  // sandbox attribute. The browser still enforces the sandbox flags for this
  // document; hide only the attribute's reflection from same-origin proxied
  // content so the player can start without gaining popup permissions.
  function hideParentSandboxMarker() {
    let frame;
    try { frame = window.frameElement; } catch (_) { return; }
    if (!frame) return;

    let hasSandbox = false;
    try { hasSandbox = frame.hasAttribute('sandbox') || frame.sandbox.length > 0; } catch (_) { return; }
    if (!hasSandbox) return;

    const emptySandbox = Object.freeze({
      length: 0,
      value: '',
      contains: () => false,
      item: () => null,
      supports: () => false,
      add() {},
      remove() {},
      replace() { return false; },
      toggle() { return false; },
      [Symbol.iterator]: function* () {}
    });
    const nativeHasAttribute = frame.hasAttribute.bind(frame);
    const nativeGetAttribute = frame.getAttribute.bind(frame);
    const nativeGetAttributeNames = frame.getAttributeNames.bind(frame);
    const nativeRemoveAttribute = frame.removeAttribute.bind(frame);
    const nativeSetAttribute = frame.setAttribute.bind(frame);
    const nativeToggleAttribute = frame.toggleAttribute.bind(frame);
    const nativeRemoveAttributeNS = frame.removeAttributeNS.bind(frame);
    const isSandboxName = name => String(name).toLowerCase() === 'sandbox';
    const define = (name, descriptor) => {
      try { Object.defineProperty(frame, name, { configurable: false, ...descriptor }); } catch (_) {}
    };

    define('sandbox', { enumerable: true, get: () => emptySandbox });
    define('hasAttribute', { value: name => isSandboxName(name) ? false : nativeHasAttribute(name) });
    define('getAttribute', { value: name => isSandboxName(name) ? null : nativeGetAttribute(name) });
    define('getAttributeNames', { value: () => nativeGetAttributeNames().filter(name => !isSandboxName(name)) });
    define('removeAttribute', { value: name => { if (!isSandboxName(name)) nativeRemoveAttribute(name); } });
    define('setAttribute', { value: (name, value) => { if (!isSandboxName(name)) nativeSetAttribute(name, value); } });
    define('toggleAttribute', { value: (name, force) => isSandboxName(name) ? false : nativeToggleAttribute(name, force) });
    define('removeAttributeNS', { value: (namespace, name) => { if (!isSandboxName(name)) nativeRemoveAttributeNS(namespace, name); } });

    try {
      const attributes = frame.attributes;
      const visible = () => Array.from(attributes).filter(attribute => !isSandboxName(attribute.name));
      const maskedAttributes = new Proxy(attributes, {
        get(target, property) {
          const list = visible();
          if (property === 'length') return list.length;
          if (property === 'item') return index => list[index] || null;
          if (property === 'getNamedItem') return name => isSandboxName(name) ? null : target.getNamedItem(name);
          if (property === 'getNamedItemNS') return (namespace, name) => isSandboxName(name) ? null : target.getNamedItemNS(namespace, name);
          if (property === 'setNamedItem' || property === 'removeNamedItem') return attribute => isSandboxName(attribute?.name || attribute) ? null : target[property](attribute);
          if (property === 'removeNamedItemNS') return (namespace, name) => isSandboxName(name) ? null : target.removeNamedItemNS(namespace, name);
          if (property === Symbol.iterator) return function* () { yield* list; };
          if (typeof property === 'string' && /^\d+$/.test(property)) return list[Number(property)];
          return Reflect.get(target, property, target);
        }
      });
      define('attributes', { enumerable: true, get: () => maskedAttributes });
    } catch (_) {}

    try {
      const nativeClone = frame.cloneNode.bind(frame);
      define('outerHTML', {
        enumerable: true,
        get() {
          const clone = nativeClone(false);
          clone.removeAttribute('sandbox');
          return clone.outerHTML;
        }
      });
    } catch (_) {}
  }

  hideParentSandboxMarker();
  const earlyProxyScript = document.currentScript?.dataset?.trosProxyEarly === '1';
  // Let the on-demand Scramjet runtime install its hooks before window.open
  // becomes non-configurable. The actual movie iframe remains sandboxed.
  const deferPopupGuard = document.currentScript?.dataset?.trosDeferPopupGuard === '1';
  const guardKey = '__TR_OS_POPUP_GUARD__';
  const existingGuard = window[guardKey];
  if (existingGuard) {
    if (!earlyProxyScript && !deferPopupGuard) existingGuard.installPopups();
    return;
  }
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
  function installPopups() {
    let popupScope = window;
    for (let depth = 0; depth < 8; depth++) {
      denyPopups(popupScope);
      try {
        const parent = popupScope.parent;
        if (!parent || parent === popupScope || !parent.document?.documentElement) break;
        popupScope = parent;
      } catch (_) { break; }
    }
  }
  try { Object.defineProperty(window, guardKey, { configurable: false, enumerable: false, value: { installPopups } }); } catch (_) {}
  if (earlyProxyScript) document.addEventListener('DOMContentLoaded', installPopups, { once: true });
  else if (!deferPopupGuard) installPopups();
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

