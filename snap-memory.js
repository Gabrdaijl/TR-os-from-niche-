// Low-allocation base64 encoding for the shared Scramjet WASM payload.
(() => {
  const release = '20261022.9';
  function toBase64(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('Expected WASM bytes');
    let binary = '';
    const chunkSize = 32768;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }
  globalThis.TR_OS_SNAP_MEMORY = Object.freeze({ release, toBase64 });
})();