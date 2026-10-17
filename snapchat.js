// Snapchat uses a separate Scramjet 2 controller; the existing proxy is unchanged.
// Upstream source and pinned versions: see snapchat-notices.html.
(async () => {
  const status = document.getElementById('status');
  const message = document.getElementById('message');
  const element = document.getElementById('player');
  document.getElementById('retry').onclick = () => location.reload();
  try {
    await TR_OS.ensureServiceWorker();
    const transport = new EpoxyTransport.default({ wisp: TR_OS.wispUrl('/wisp-vps/') });
    await transport.init();
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
