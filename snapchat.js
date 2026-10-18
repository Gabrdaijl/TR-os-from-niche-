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
    transport.connect = (url, protocols, headers, ...callbacks) => {
      // The pinned Epoxy writes an absolute HTTP request target. RFC 6455
      // allows HTTP(S) here; retain the same TLS, host, port, path and query.
      const requestUrl = new URL(url.href);
      if (requestUrl.protocol === 'wss:') requestUrl.protocol = 'https:';
      else if (requestUrl.protocol === 'ws:') requestUrl.protocol = 'http:';
      return epoxyConnect(requestUrl, protocols,
        headers.filter(header => header[0].toLowerCase() !== 'user-agent'), ...callbacks);
    };
    // Use libcurl's origin-form socket handshake; HTTP and cookie ownership
    // stay with this controller. socket=epoxy remains a controlled comparison.
    const query = new URL(location.href).searchParams;
    if (query.get('socket') !== 'epoxy') {
      await TR_OS.withTimeout(new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/snap-curl-transport.js';
        script.onload = resolve;
        script.onerror = () => reject(new Error('Snapchat-transporten kunde inte laddas.'));
        document.head.append(script);
      }), 20000, 'Snapchat-transporten tog för lång tid att starta.');
      const curl = new LibcurlTransport.LibcurlClient({ wisp: TR_OS.wispUrl('/wisp-vps/') });
      await TR_OS.withTimeout(curl.init(), 20000, 'Snapchat-transporten tog för lång tid att starta.');
      if (query.get('tlsCheck') === '1') {
        let rejectedCertificate = false;
        try { await TR_OS.withTimeout(curl.request(new URL('https://self-signed.badssl.com/'), 'GET', null, []), 20000, 'TLS-kontrollen tog för lång tid.'); }
        catch (failure) { rejectedCertificate = /certificate|cert verify|ssl peer/i.test(String(failure)); }
        if (!rejectedCertificate) throw new Error('Transportens certifikatkontroll kunde inte verifieras.');
        const valid = await TR_OS.withTimeout(curl.request(new URL('https://example.com/'), 'GET', null, []), 20000, 'TLS-kontrollen tog för lång tid.');
        if (valid.status !== 200) throw new Error('Transportens giltiga HTTPS-anslutning kunde inte verifieras.');
        console.info('TR-os Snapchat TLS check: untrusted certificate rejected; valid HTTPS accepted');
      }
      transport.connect = (url, protocols, headers, open, data, close, error) => {
        let phase = 'opening', callbacks;
        const timer = setTimeout(() => {
          if (phase !== 'opening') return;
          phase = 'failed';
          try { Promise.resolve(callbacks?.[1](1000, '')).catch(() => {}); } catch {}
          error('Snapchat socket handshake timed out');
        }, 15000);
        const fail = (...args) => {
          clearTimeout(timer);
          if (phase === 'failed' || phase === 'closed') return;
          if (phase === 'opening') phase = 'failed';
          error(...args);
        };
        try {
          callbacks = curl.connect(url, protocols, headers,
            (...args) => {
              if (phase !== 'opening') return;
              clearTimeout(timer); phase = 'open'; open(...args);
            },
            (...args) => { if (phase === 'open') data(...args); },
            (...args) => {
              if (phase === 'opening') return fail('Snapchat socket closed before handshake');
              clearTimeout(timer);
              if (phase === 'open') { phase = 'closed'; close(...args); }
            }, fail);
          return callbacks;
        } catch (failure) { clearTimeout(timer); throw failure; }
      };
    }
    // Opt-in connection metadata only: never log cookies, URLs with queries,
    // protocol values, request bodies or message contents.
    if (new URL(location.href).searchParams.get('diagnostics') === '1') {
      const request = transport.request.bind(transport);
      transport.request = async (...args) => {
        const response = await request(...args);
        if (response.status >= 400) console.info('TR-os Snapchat HTTP', JSON.stringify({
          host: args[0].hostname, status: response.status
        }));
        return response;
      };
      const connect = transport.connect.bind(transport);
      transport.connect = (url, protocols, headers, open, data, close, error) => {
        const info = { host: url.hostname, scheme: url.protocol,
          headers: headers.map(header => header[0].toLowerCase()),
          protocols: Array.isArray(protocols) ? protocols.length : Number(!!protocols) };
        const origin = headers.find(header => header[0].toLowerCase() === 'origin');
        try { info.originHost = origin ? new URL(origin[1]).hostname : ''; } catch { info.originHost = 'opaque'; }
        console.info('TR-os Snapchat socket start', JSON.stringify(info));
        return connect(url, protocols, headers,
          (...args) => { console.info('TR-os Snapchat socket open', JSON.stringify({ host: url.hostname, hasProtocol: !!args[0] })); open(...args); },
          data, close,
          (...args) => { console.info('TR-os Snapchat socket failed', JSON.stringify({ host: url.hostname })); error(...args); });
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
