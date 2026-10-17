(async () => {
  try {
    const { ScramjetController } = $scramjetLoadController();
    const client = new ScramjetController({ files: {
      wasm: TR_OS.assetUrl('scram/scramjet.wasm.wasm'), all: TR_OS.assetUrl('scram/scramjet.all.js'), sync: TR_OS.assetUrl('scram/scramjet.sync.js')
    } });
    await client.init();
    await TR_OS.ensureServiceWorker();
    const connection = new BareMux.BareMuxConnection(TR_OS.assetUrl('baremux/worker.js'));
    await connection.setTransport(TR_OS.assetUrl('epoxy/index.mjs'), [{ wisp: TR_OS.wispUrl('/wisp-vps/') }]);
    // This public integration remains hosted by its original operator.
    const frame = document.getElementById('cheats-frame');
    frame.addEventListener('load', () => { frame.hidden = false; document.getElementById('status').hidden = true; });
    const platforms = { gimkit: 'https://www.gimkit.com/join', kahoot: 'https://kahoot.it/', blooket: 'https://play.blooket.com/' };
    function loadPlatform(name) {
      const url = platforms[name];
      frame.hidden = true;
      document.getElementById('status').hidden = false;
      document.getElementById('status').textContent = 'Loading ' + name + '…';
      document.getElementById('platform-info').textContent = name + ' · Official join page. No cheats are installed for this game.';
      document.getElementById('open-platform').href = url;
      frame.src = client.encodeUrl(url);
    }
    document.querySelectorAll('[data-platform]').forEach(button => button.addEventListener('click', () => loadPlatform(button.dataset.platform)));
    loadPlatform('gimkit');
  } catch (error) {
    document.getElementById('status').textContent = 'Cheats could not connect. Reload to try again.';
    console.error('Cheats:', error);
  }
})();
