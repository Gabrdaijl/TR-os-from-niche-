(function () {
  'use strict';
  const cfg = window.TR_OS_CONFIG || {};
  const base = new URL('.', document.currentScript.src);
  const apiBase = cfg.apiBase ? new URL(cfg.apiBase, base).href.replace(/\/$/, '') : location.origin;
  const socketBase = new URL(cfg.wispBase || apiBase);
  socketBase.protocol = socketBase.protocol === 'https:' || socketBase.protocol === 'wss:' ? 'wss:' : 'ws:';
  const nativeFetch = window.fetch.bind(window);
  function apiUrl(path) { return new URL(String(path).replace(/^\//, ''), apiBase + '/').href; }
  window.TR_OS = Object.freeze({
    apiBase,
    aiUrl: new URL(cfg.aiUrl || '/api/ai', apiBase + '/').href,
    apiUrl,
    wispUrl: function (path) { return new URL(String(path).replace(/^\//, ''), socketBase.href.replace(/\/$/, '') + '/').href; },
    fetch: function (input, options) {
      if (typeof input === 'string' && /^\/?(?:api\/|online(?:\?|$)|chat\/|cloud\/v1\/)/.test(input)) input = apiUrl(input);
      return nativeFetch(input, options);
    }
  });
}());
