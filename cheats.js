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
    frame.addEventListener('load', () => { frame.hidden = false; document.getElementById('status').hidden = true; }, { once: true });
    frame.src = client.encodeUrl('https://t9os.space/join');
  } catch (error) {
    document.getElementById('status').textContent = 'Cheats could not connect. Reload to try again.';
    console.error('Cheats:', error);
  }
})();
