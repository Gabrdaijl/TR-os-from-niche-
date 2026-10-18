// Opt-in crash location summary. No envelope content or exception message leaves
// this parser; forwarding keeps the original bytes, including on parser failure.
(() => {
  const limit = 262144;
  const types = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'DOMException', 'AssertionError', 'InvariantViolation', 'DataCloneError', 'SecurityError', 'InvalidStateError', 'NotSupportedError', 'NotAllowedError', 'AbortError', 'QuotaExceededError', 'NetworkError', 'OperationError', 'UnhandledRejection']);
  function category(value) {
    if (typeof value !== 'string') return 'unknown';
    for (const [name, pattern] of [
      ['structured-clone', /could not be cloned|cannot be cloned|not transferable|DataCloneError/i],
      ['cross-origin', /cross.origin|Blocked a frame|Permission denied to access/i],
      ['storage', /Failed to read.*(?:local|session)Storage|StorageAccess/i],
      ['missing-api', /is not defined|is not a function/i],
      ['null-property', /Cannot (?:read|set) properties of (?:undefined|null)/i],
      ['wasm', /WebAssembly|CompileError|LinkError/i],
      ['socket', /WebSocket|socket/i],
      ['url', /wrong URL|invalid URL/i],
      ['worker', /Worker|postMessage/i]
    ]) if (pattern.test(value)) return name;
    return 'unknown';
  }
  function frame(value) {
    try {
      let url = new URL(value.filename);
      if (url.origin === location.origin && url.pathname.startsWith('/snap-proxy/')) {
        const encoded = url.pathname.split('/').find(part => /^https%3A/i.test(part));
        if (!encoded) return null;
        url = new URL(decodeURIComponent(encoded));
      }
      if (url.protocol !== 'https:' || url.username || url.password || url.port ||
          !(url.hostname === 'www.snapchat.com' || /(^|\.)sc-cdn\.net$/.test(url.hostname))) return null;
      // Only hashed public JavaScript assets, never account-specific paths.
      if (!/^\/dw\/[a-f0-9]{16,64}\.js$/i.test(url.pathname)) return null;
      if (!Number.isSafeInteger(value.lineno) || value.lineno < 1 || value.lineno > 10000000 ||
          !Number.isSafeInteger(value.colno) || value.colno < 0 || value.colno > 100000000) return null;
      return { asset: url.origin + url.pathname, line: value.lineno, column: value.colno };
    } catch { return null; }
  }
  function summary(bytes) {
    if (bytes.byteLength > limit) return null;
    const lines = new TextDecoder().decode(bytes).split('\n');
    for (let i = 1; i < lines.length - 1; i++) {
      let header, payload;
      try { header = JSON.parse(lines[i]); } catch { continue; }
      if (header?.type !== 'event') continue;
      try { payload = JSON.parse(lines[i + 1]); } catch { continue; }
      const values = payload?.exception?.values;
      const value = Array.isArray(values) ? values.slice(0, 3).find(item => types.has(item?.type)) || values[0] : null;
      if (!value || typeof value !== 'object') continue;
      const frames = Array.isArray(value.stacktrace?.frames) ? value.stacktrace.frames.slice(-16).map(frame).filter(Boolean).slice(-8) : [];
      return { type: types.has(value.type) ? value.type : 'Other', category: category(value.value), frames };
    }
    return null;
  }
  async function read(stream) {
    const reader = stream.getReader(), chunks = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!(value instanceof Uint8Array) || (length += value.byteLength) > limit) {
          Promise.resolve(reader.cancel()).catch(() => {}); return null;
        }
        chunks.push(value.slice());
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return summary(bytes);
    } catch { return null; }
    finally { reader.releaseLock(); }
  }
  function observe(body, report) {
    try {
      if (body && typeof body.tee === 'function') {
        const [forward, copy] = body.tee();
        read(copy).then(value => { if (value) report(value); }).catch(() => {});
        return forward;
      }
      if (typeof body === 'string' && body.length > limit) return body;
      const bytes = typeof body === 'string' ? new TextEncoder().encode(body) :
        body instanceof ArrayBuffer ? new Uint8Array(body) : ArrayBuffer.isView(body) ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength) : null;
      if (bytes) { const value = summary(bytes); if (value) report(value); }
    } catch {}
    return body;
  }
  window.TR_OS_SNAP_DIAGNOSTICS = { observe };
})();
