(async () => {
  const release = '20261022.6';
  const query = new URL(location.href).searchParams;
  const compatibilityEnabled = query.get('optionalNotifications') !== '0';
  const diagnostics = query.get('diagnostics') === '1';
  const status = document.getElementById('status');
  const message = document.getElementById('message');
  const element = document.getElementById('player');
  document.getElementById('retry').onclick = () => location.reload();
  let support;
  try {
    const compatibilityReady = window.TR_OS_SNAP_COMPAT?.release === release && typeof window.TR_OS_SNAP_COMPAT?.response === 'function';
    try {
      if (window.TR_OS_SNAP_REPORT?.release === release) support = window.TR_OS_SNAP_REPORT.create(diagnostics, compatibilityReady,
        { compatibilityEnabled, socketMode: query.get('socket') === 'epoxy' ? 'epoxy' : 'curl' });
    } catch {}
    if (diagnostics) console.info('TR-os Snapchat startup', JSON.stringify({ release, compatibilityEnabled, compatibilityReady }));
    if (compatibilityEnabled && !compatibilityReady) throw new Error('Snapchat-filerna kunde inte uppdateras. Ladda om TR-os och försök igen.');
    support?.stage('service-worker');
    await TR_OS.ensureServiceWorker();
    TR_OS_SNAP_WORKER.install($scramjetController);
    support?.stage('transport');
    const transport = new EpoxyTransport.default({ wisp: TR_OS.wispUrl('/wisp-vps/') });
    await TR_OS.withTimeout(transport.init(), 20000, 'Snapchat-anslutningen kunde inte startas. Försök igen.');
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
    if (query.get('socket') !== 'epoxy') {
      if(window.TR_OS_SNAP_CURL?.release!==release)throw new Error('Snapchat-filerna kunde inte uppdateras. Ladda om TR-os och försök igen.');
      const lazy=window.TR_OS_SNAP_CURL.create(async()=>{
      await TR_OS.withTimeout(new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/snap-curl-transport.js?v=' + release + '-snap-image-budget';
        script.onload = resolve;
        script.onerror = () => reject(new Error('Snapchat-transporten kunde inte laddas.'));
        document.head.append(script);
      }), 20000, 'Snapchat-transporten tog för lång tid att starta.');
      const curl = new LibcurlTransport.LibcurlClient({ wisp: TR_OS.wispUrl('/wisp-vps/') });
      await TR_OS.withTimeout(curl.init(), 20000, 'Snapchat-transporten tog för lång tid att starta.');
      return curl;
      });
      if (query.get('tlsCheck') === '1') {
        const curl=await lazy.client();
        let rejectedCertificate = false;
        try { await TR_OS.withTimeout(curl.request(new URL('https://self-signed.badssl.com/'), 'GET', null, []), 20000, 'TLS-kontrollen tog för lång tid.'); }
        catch (failure) { rejectedCertificate = /certificate|cert verify|ssl peer/i.test(String(failure)); }
        if (!rejectedCertificate) throw new Error('Transportens certifikatkontroll kunde inte verifieras.');
        const valid = await TR_OS.withTimeout(curl.request(new URL('https://example.com/'), 'GET', null, []), 20000, 'TLS-kontrollen tog för lång tid.');
        if (valid.status !== 200) throw new Error('Transportens giltiga HTTPS-anslutning kunde inte verifieras.');
        console.info('TR-os Snapchat TLS check: untrusted certificate rejected; valid HTTPS accepted');
      }
      transport.connect = lazy.connect;
      // Live diagnostics recorded HTTP 501 for Snapchat's signed media PUT
      // on cf-st.sc-cdn.net through Epoxy. Route only that upload method and
      // host through libcurl over the same Wisp connection; leave API calls
      // and all other hosts on Epoxy.
      const epoxyRequest = transport.request.bind(transport);
      transport.request = async (...args) => {
        const remote = args[0];
        const method = typeof args[1] === 'string' ? args[1].toUpperCase() : '';
        if (remote?.protocol === 'https:' && remote.hostname === 'cf-st.sc-cdn.net' && method === 'PUT') {
          const curl = await lazy.client();
          return curl.request(...args);
        }
        return epoxyRequest(...args);
      };
    }
    // Opt-in connection metadata only: never log cookies, URLs with queries,
    // protocol values, request bodies or message contents.
    if (compatibilityEnabled) {
      const request = transport.request.bind(transport);
      transport.request = async (...args) => {
        const response = await request(...args);
        return args[1] === 'GET' ? window.TR_OS_SNAP_COMPAT.response(response, args[0], outcome => {
          support?.compatibility(outcome);
          if (diagnostics) console.info('TR-os Snapchat compatibility', JSON.stringify({ release, outcome }));
        }) : response;
      };
    }
    if (diagnostics) {
      const request = transport.request.bind(transport);
      transport.request = async (...args) => {
        const host = args[0]?.hostname;
        const method = typeof args[1] === 'string' ? args[1].toUpperCase() : '';
        const isUpload = ['POST', 'PUT', 'PATCH'].includes(method) &&
          typeof host === 'string' && /(^|\.)(snapchat\.com|sc-cdn\.net|sc-prod\.net)$/i.test(host);
        if (args[0].hostname === 'sentry.sc-prod.net' && window.TR_OS_SNAP_DIAGNOSTICS) {
          args[2] = window.TR_OS_SNAP_DIAGNOSTICS.observe(args[2], value => {
            support?.crash(value);
            console.info('TR-os Snapchat crash location', JSON.stringify(value));
          });
        }
        let response;
        try { response = await request(...args); }
        catch (error) {
          if (isUpload) support?.upload(host, method, 'network-error');
          throw error;
        }
        if (args[1] === 'GET') support?.asset(args[0].href, response.status);
        if (isUpload) support?.upload(host, method, response.status);
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
        support?.socket('opening');
        return connect(url, protocols, headers,
          (...args) => { support?.socket('open'); console.info('TR-os Snapchat socket open', JSON.stringify({ host: url.hostname, hasProtocol: !!args[0] })); open(...args); },
          data, (...args) => { support?.socket('closed'); close(...args); },
          (...args) => { support?.socket('failed'); console.info('TR-os Snapchat socket failed', JSON.stringify({ host: url.hostname })); error(...args); });
      };
    }
    support?.stage('engine');
    const controller = new $scramjetController.Controller({
      serviceworker: navigator.serviceWorker.controller,
      transport,
      config: {
        prefix: '/snap-proxy/', scramjetPath: '/snap-engine.js?v=' + release,
        injectPath: '/snap-controller.inject.js?v=' + release, wasmPath: '/snap-engine.wasm?v=' + release
      }
    });
    await TR_OS.withTimeout(controller.wait(), 20000, 'Snapchat-motorn kunde inte startas. Ladda om TR-os och försök igen.');
    const frame = controller.createFrame(element);
    try {
      if (diagnostics && window.TR_OS_SNAP_CALLS?.release === release) {
        window.TR_OS_SNAP_CALLS.install(frame, true, value => support?.call(value));
      }
    } catch {}
    element.addEventListener('load', () => {
      status.hidden = true;
      support?.stage('page-loaded');
    });
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
    support?.stage('startup-failed');
    message.textContent = error.message || 'Snapchat kunde inte startas.';
    document.getElementById('retry').hidden = false;
  }
})();
