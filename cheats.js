(() => {
  const frame = document.getElementById('cheats-frame');
  const status = document.getElementById('status');
  const info = document.getElementById('platform-info');
  const platforms = {
    gimkit: { url: 'https://t9os.space/join', label: 'Gimkit · verktyg via extern tjänst. Funktioner kräver en spelomgång du får använda.', direct: true },
    kahoot: { url: 'https://kahoot.it/', label: 'Kahoot · officiell anslutningssida. Ingen hackmodul är installerad.' },
    blooket: { url: 'https://play.blooket.com/', label: 'Blooket · officiell anslutningssida. Ingen hackmodul är installerad.' }
  };
  let proxy, generation = 0;
  function ensureProxy() {
    if (!proxy) proxy = (async () => {
      const { ScramjetController } = $scramjetLoadController();
      const client = new ScramjetController({ files: {
        wasm: TR_OS.assetUrl('scram/scramjet.wasm.wasm'), all: TR_OS.assetUrl('scram/scramjet.all.js'), sync: TR_OS.assetUrl('scram/scramjet.sync.js')
      } });
      await client.init();
      await TR_OS.ensureServiceWorker();
      const connection = new BareMux.BareMuxConnection(TR_OS.assetUrl('baremux/worker.js'));
      await connection.setTransport(TR_OS.assetUrl('epoxy/index.mjs'), [{ wisp: TR_OS.wispUrl('/wisp-vps/') }]);
      return client;
    })().catch(error => { proxy = null; throw error; });
    return proxy;
  }
  frame.addEventListener('load', () => {
    frame.hidden = false;
    status.hidden = true;
  });
  async function loadPlatform(name) {
    const platform = platforms[name];
    if (!platform) return;
    const current = ++generation;
    frame.hidden = true;
    status.hidden = false;
    status.textContent = 'Laddar ' + name + '…';
    info.textContent = platform.label;
    document.getElementById('open-platform').href = platform.url;
    try {
      const src = platform.direct ? platform.url : (await ensureProxy()).encodeUrl(platform.url);
      if (current !== generation) return;
      frame.src = src;
      // External pages can keep fetching optional assets after their controls
      // are ready. Do not hide the usable page until every asset finishes.
      frame.hidden = false;
      status.hidden = true;
    } catch (error) {
      if (current !== generation) return;
      status.textContent = 'Sidan kunde inte anslutas. Använd Öppna separat för att prova direkt.';
      console.error('TR-os game tools:', error);
    }
  }
  document.querySelectorAll('[data-platform]').forEach(button => button.addEventListener('click', () => loadPlatform(button.dataset.platform)));
  loadPlatform('gimkit');
})();
