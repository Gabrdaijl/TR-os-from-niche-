// Device-local, opt-in support report. No requests, storage, account data or
// raw errors enter this report. It never inspects the Snapchat document.
(() => {
  const release = '20261022.1';
  const outcomes = new Set(['applied', 'skipped-status', 'skipped-body', 'oversize', 'idle-timeout', 'total-timeout', 'hash-mismatch', 'source-mismatch', 'read-error', 'hash-error', 'decode-error', 'source-error', 'encode-error']);
  const stages = new Set(['starting', 'service-worker', 'transport', 'engine', 'page-loaded', 'startup-failed']);
  const categories = new Set(['structured-clone', 'cross-origin', 'storage', 'missing-api', 'null-property', 'wasm', 'socket', 'url', 'worker', 'unknown']);
  const types = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'DOMException', 'AssertionError', 'InvariantViolation', 'DataCloneError', 'SecurityError', 'InvalidStateError', 'NotSupportedError', 'NotAllowedError', 'AbortError', 'QuotaExceededError', 'NetworkError', 'OperationError', 'UnhandledRejection', 'Other', 'CompileError', 'LinkError', 'RuntimeError']);
  const callStates = {
    capability: { secure: new Set(['yes', 'no', 'unknown']), camera: new Set(['yes', 'no', 'unknown']), microphone: new Set(['yes', 'no', 'unknown']), media: new Set(['yes', 'no', 'unknown']), rtc: new Set(['yes', 'no', 'unknown']) },
    media: { request: new Set(['getUserMedia']), ready: new Set(['getUserMedia']), error: new Set(['NotAllowedError', 'NotFoundError', 'NotReadableError', 'OverconstrainedError', 'AbortError', 'InvalidStateError', 'SecurityError', 'TypeError', 'NotSupportedError', 'Other']) },
    rtc: { created: new Set(['new']), connection: new Set(['new', 'connecting', 'connected', 'disconnected', 'failed', 'closed']), ice: new Set(['new', 'checking', 'connected', 'completed', 'disconnected', 'failed', 'closed']), signaling: new Set(['stable', 'have-local-offer', 'have-remote-offer', 'have-local-pranswer', 'have-remote-pranswer', 'closed']), gathering: new Set(['new', 'gathering', 'complete']) }
  };
  function publicAsset(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.port ||
          !(url.hostname === 'www.snapchat.com' || /(^|\.)sc-cdn\.net$/.test(url.hostname)) ||
          !/^\/dw\/[a-f0-9]{16,64}\.js$/i.test(url.pathname)) return null;
      return url.origin + url.pathname;
    } catch { return null; }
  }
  function create(enabled, compatibilityReady, options = {}) {
    const userAgent = navigator.userAgent || '';
    const chrome = userAgent.match(/\b(?:Chrome|Chromium)\/(\d{1,4})\./);
    const state = { release, diagnostics: !!enabled,
      browser: { family: chrome ? 'Chrome' : 'other', major: chrome ? Number(chrome[1]) : null,
        platform: /\bCrOS\b/.test(userAgent) ? 'ChromeOS' : 'other' },
      capabilities: { streams: typeof ReadableStream === 'function', digest: typeof crypto !== 'undefined' && typeof crypto.subtle?.digest === 'function',
        wasm: typeof WebAssembly === 'object', worker: typeof Worker === 'function' },
      stage: 'starting', compatibilityReady: !!compatibilityReady, compatibilityEnabled: options.compatibilityEnabled !== false,
      socketMode: options.socketMode === 'epoxy' ? 'epoxy' : 'curl', compatibility: 'not-observed', socket: 'not-observed', scripts: [], uploads: [], crashes: [], calls: [] };
    const output = document.getElementById('support-output');
    const text = () => 'TR-os Snapchat\n' + JSON.stringify(state, null, 2);
    const render = () => { if (output) output.value = text(); };
    const toggle = document.getElementById('support-toggle');
    const panel = document.getElementById('support-panel');
    if (toggle && panel) {
      toggle.textContent = enabled ? 'Felkod' : 'Hjälp';
      toggle.onclick = () => { panel.hidden = !panel.hidden; toggle.setAttribute('aria-expanded', String(!panel.hidden)); render(); };
      document.getElementById('support-close').onclick = () => { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); };
      document.getElementById('support-intro').hidden = !!enabled;
      document.getElementById('support-active').hidden = !enabled;
      document.getElementById('support-start').onclick = () => {
        const target = new URL(location.href);
        target.searchParams.set('diagnostics', '1');
        location.replace(target.href);
      };
      document.getElementById('support-copy').onclick = async () => {
        const result = document.getElementById('support-result');
        try { await navigator.clipboard.writeText(text()); result.textContent = 'Felkoden är kopierad.'; }
        catch { output.focus(); output.select(); result.textContent = 'Tryck Ctrl+C för att kopiera den markerade felkoden.'; }
      };
    }
    const update = fn => { if (!enabled) return; try { fn(); render(); } catch {} };
    render();
    return {
      stage: value => update(() => { if (stages.has(value)) state.stage = value; }),
      compatibility: value => update(() => { if (outcomes.has(value)) state.compatibility = value; }),
      socket: value => update(() => { if (['opening', 'open', 'failed', 'closed'].includes(value)) state.socket = value; }),
      call: value => update(() => {
        if (!value || typeof value !== 'object') return;
        const allowed = callStates[value.area]?.[value.event];
        if (!allowed?.has(value.value)) return;
        state.calls.push({ area: value.area, event: value.event, value: value.value });
        if (state.calls.length > 24) state.calls.shift();
      }),
      asset: (value, status) => update(() => {
        const asset = publicAsset(value);
        if (!asset || !Number.isInteger(status) || status < 100 || status > 599) return;
        const previous = state.scripts.find(item => item.asset === asset);
        if (previous) previous.status = status;
        else { state.scripts.push({ asset, status }); if (state.scripts.length > 16) state.scripts.shift(); }
      }),
      upload: (host, method, status) => update(() => {
        if (typeof host !== 'string' || !/(^|\.)(snapchat\.com|sc-cdn\.net|sc-prod\.net)$/i.test(host)) return;
        const requestMethod = typeof method === 'string' ? method.toUpperCase() : '';
        if (!['POST', 'PUT', 'PATCH'].includes(requestMethod)) return;
        if (status !== 'network-error' && (!Number.isInteger(status) || status < 100 || status > 599)) return;
        state.uploads.push({ host: host.toLowerCase(), method: requestMethod, status });
        if (state.uploads.length > 8) state.uploads.shift();
      }),
      crash: value => update(() => {
        if (!value || !types.has(value.type) || !categories.has(value.category)) return;
        const frames = Array.isArray(value.frames) ? value.frames.slice(-8).flatMap(frame => {
          const asset = publicAsset(frame?.asset);
          return asset && Number.isSafeInteger(frame.line) && frame.line > 0 && frame.line <= 10000000 &&
            Number.isSafeInteger(frame.column) && frame.column >= 0 && frame.column <= 100000000 ?
            [{ asset, line: frame.line, column: frame.column }] : [];
        }) : [];
        const crash={ type: value.type, category: value.category, frames };
        if(['memory-allocation','memory-growth','table-growth','stack-overflow','compile','link','instantiate','unknown'].includes(value.wasmFailure)){
          crash.wasmFailure=value.wasmFailure;
          if(Number.isSafeInteger(value.frameCount) && value.frameCount>=0 && value.frameCount<=16)crash.frameCount=value.frameCount;
          crash.components=Array.isArray(value.components)?[...new Set(value.components.filter(item=>['wasm','rewriter','http-transport','socket-transport','worker-bridge','controller'].includes(item)))]:[];
        }
        state.crashes.push(crash);
        if (state.crashes.length > 3) state.crashes.shift();
      })
    };
  }
  window.TR_OS_SNAP_REPORT = { release, create };
})();
