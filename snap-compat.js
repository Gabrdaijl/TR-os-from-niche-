// Snapchat a4b70008 optional notification listener. The proxy does not expose
// TR-os service-worker control to upstream pages. Missing optional support must
// not crash the whole chat. No authentication or verification code is changed.
(() => {
  const sourcePath = '/dw/127ca002fe3599f56576.js';
  const sourceHash = 'd68750cc94dde81cd3d6daabf39b913381b2ff4c4d3a5bc6aad8451edb2d2a4b';
  const add = 'navigator.serviceWorker.addEventListener("message",n)';
  const remove = 'navigator.serviceWorker.removeEventListener("message",n)';
  function patch(source) {
    if (source.split(add).length !== 2 || source.split(remove).length !== 2) return null;
    return source.replace(add, 'navigator.serviceWorker?.addEventListener("message",n)')
      .replace(remove, 'navigator.serviceWorker?.removeEventListener("message",n)');
  }
  async function response(original, url) {
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hostname !== 'cf-st.sc-cdn.net' || url.pathname !== sourcePath || original.status !== 200 || !original.body?.tee) return original;
    const [forward, copy] = original.body.tee();
    const fallback = { ...original, body: forward };
    const reader = copy.getReader(), chunks = [];
    let length = 0, expired = false;
    const timer = setTimeout(() => { expired = true; Promise.resolve(reader.cancel()).catch(() => {}); }, 10000);
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!(value instanceof Uint8Array) || (length += value.byteLength) > 12582912) {
          Promise.resolve(reader.cancel()).catch(() => {}); return fallback;
        }
        chunks.push(value.slice());
      }
      const bytes = new Uint8Array(length);
      if (expired) return fallback;
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
      if (hash !== sourceHash || expired) return fallback;
      const fixed = patch(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (fixed === null) return fallback;
      Promise.resolve(forward.cancel()).catch(() => {});
      return { ...original, body: new TextEncoder().encode(fixed),
        headers: original.headers.filter(([name]) => !/^(content-length|content-encoding|etag|digest|content-digest|content-md5)$/i.test(name)) };
    } catch { return fallback; }
    finally { clearTimeout(timer); reader.releaseLock(); }
  }
  window.TR_OS_SNAP_COMPAT = { response };
})();
