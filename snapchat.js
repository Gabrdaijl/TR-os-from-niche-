// Snapchat uses a separate Scramjet 2 controller; the existing proxy is unchanged.
// Upstream source and pinned versions: see snapchat-notices.html.
(async () => {
  const status = document.getElementById('status');
  const message = document.getElementById('message');
  const element = document.getElementById('player');
  document.getElementById('retry').onclick = () => location.reload();
  try {
    await TR_OS.ensureServiceWorker();
    TR_OS_SNAP_WORKER.install($scramjetController);
    const transport = new EpoxyTransport.default({ wisp: TR_OS.wispUrl('/wisp-vps/') });
    await transport.init();
    const epoxyConnect = transport.connect.bind(transport);
    // Epoxy already supplies the browser's UA. A second copy from Scramjet
    // produces duplicate User-Agent fields in the upstream upgrade request.
    transport.connect = (url, protocols, headers, ...callbacks) => epoxyConnect(
      url, protocols, headers.filter(header => header[0].toLowerCase() !== 'user-agent'), ...callbacks
    );
    // Opt-in connection metadata only: never log cookies, URLs with queries,
    // protocol values, request bodies or message contents.
    if (new URL(location.href).searchParams.get('diagnostics') === '1') {
      const request = transport.request.bind(transport);
      transport.request = async (...args) => {
        const response = await request(...args);
        if (response.status >= 400) console.info('TR-os Snapchat HTTP', {
          host: args[0].hostname, status: response.status
        });
        return response;
      };
      const connect = transport.connect.bind(transport);
      transport.connect = (url, protocols, headers, open, data, close, error) => {
        const info = { host: url.hostname, scheme: url.protocol,
          headers: headers.map(header => header[0].toLowerCase()),
          protocols: Array.isArray(protocols) ? protocols.length : Number(!!protocols) };
        const origin = headers.find(header => header[0].toLowerCase() === 'origin');
        try { info.originHost = origin ? new URL(origin[1]).hostname : ''; } catch { info.originHost = 'opaque'; }
        console.info('TR-os Snapchat socket start', info);
        return connect(url, protocols, headers,
          (...args) => { console.info('TR-os Snapchat socket open', { host: url.hostname }); open(...args); },
          data, close,
          (...args) => { console.info('TR-os Snapchat socket failed', { host: url.hostname }); error(...args); });
      };
    }
    const controller = new $scramjetController.Controller({
      serviceworker: navigator.serviceWorker.controller,
      transport,
      config: {
        prefix: '/snap-proxy/', scramjetPath: '/snap-engine.js',
        injectPath: '/snap-controller.inject.js', wasmPath: '/snap-engine.wasm'
      }
    });
    await TR_OS.withTimeout(controller.wait(), 20000, 'Snapchat-motorn kunde inte startas. Ladda om TR-os och försök igen.');
    const frame = controller.createFrame(element);
    element.addEventListener('load', () => { status.hidden = true; });
    let lastLocation = '';
    function syncLocation() {
      try {
        const current = new URL(element.contentWindow.location.href);
        if (!current.pathname.startsWith('/snap-proxy/')) return;
        const encoded = current.pathname.split('/').find(part => /^https%3A/i.test(part));
        if (!encoded) return;
        const url = new URL(decodeURIComponent(encoded));
        if (!/(^|\.)snapchat\.com$/i.test(url.hostname) || url.href === lastLocation) return;
        lastLocation = url.href;
        parent.postMessage({ type: 'tros-snapchat-location', url: url.href }, location.origin);
      } catch {}
    }
    const timer = setInterval(syncLocation, 1000);
    window.addEventListener('pagehide', () => clearInterval(timer));
    frame.go('https://web.snapchat.com/');
  } catch (error) {
    message.textContent = error.message || 'Snapchat kunde inte startas.';
    document.getElementById('retry').hidden = false;
  }
})();
