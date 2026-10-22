// Snapchat a4b70008 optional notification listener. The proxy does not expose
// TR-os service-worker control to upstream pages. Missing optional support must
// not crash the whole chat. No authentication or verification code is changed.
(() => {
  const release = '20261022.1';
  const sourcePath = '/dw/127ca002fe3599f56576.js';
  const sourceHash = 'd68750cc94dde81cd3d6daabf39b913381b2ff4c4d3a5bc6aad8451edb2d2a4b';
  const add = 'navigator.serviceWorker.addEventListener("message",n)';
  const remove = 'navigator.serviceWorker.removeEventListener("message",n)';
  function patch(source) {
    const exactlyOnce = value => { const first = source.indexOf(value); return first >= 0 && source.indexOf(value, first + value.length) < 0; };
    if (!exactlyOnce(add) || !exactlyOnce(remove)) return null;
    return source.replace(add, 'navigator.serviceWorker?.addEventListener("message",n)')
      .replace(remove, 'navigator.serviceWorker?.removeEventListener("message",n)');
  }
  async function response(original, url, report) {
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hostname !== 'cf-st.sc-cdn.net' || url.pathname !== sourcePath) return original;
    const finish = (outcome, value) => { try { report?.(outcome); } catch {} return value; };
    if (original.status !== 200) return finish('skipped-status', original);
    if (!original.body?.tee) return finish('skipped-body', original);
    const [forward, copy] = original.body.tee();
    const fallback = { ...original, body: forward };
    const reader = copy.getReader(), chunks = [];
    let length = 0, expired = '', idleTimer, failure = 'read-error';
    const expire = reason => { expired ||= reason; Promise.resolve(reader.cancel()).catch(() => {}); };
    const timer = setTimeout(() => expire('total-timeout'), 120000);
    try {
      while (true) {
        idleTimer = setTimeout(() => expire('idle-timeout'), 15000);
        const { done, value } = await reader.read();
        clearTimeout(idleTimer);
        if (expired) return finish(expired, fallback);
        if (done) break;
        if (!(value instanceof Uint8Array) || (length += value.byteLength) > 12582912) {
          Promise.resolve(reader.cancel()).catch(() => {}); return finish('oversize', fallback);
        }
        chunks.push(value.slice());
      }
      const bytes = new Uint8Array(length);
      if (expired) return finish(expired, fallback);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      chunks.length = 0;
      failure = 'hash-error';
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
      if (expired) return finish(expired, fallback);
      if (hash !== sourceHash) return finish('hash-mismatch', fallback);
      failure = 'decode-error';
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      failure = 'source-error';
      const fixed = patch(decoded);
      if (fixed === null) return finish('source-mismatch', fallback);
      failure = 'encode-error';
      const result = { ...original, body: new TextEncoder().encode(fixed),
        headers: original.headers.filter(([name]) => !/^(content-length|content-encoding|etag|digest|content-digest|content-md5)$/i.test(name)) };
      Promise.resolve(forward.cancel()).catch(() => {});
      return finish('applied', result);
    } catch { return finish(failure, fallback); }
    finally { clearTimeout(timer); clearTimeout(idleTimer); reader.releaseLock(); }
  }
  window.TR_OS_SNAP_COMPAT = { release, response };
})();
