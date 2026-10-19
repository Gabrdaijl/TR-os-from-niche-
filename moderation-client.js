(() => {
  'use strict';
  const blockedMarkup = '<main style="min-height:100vh;display:grid;place-items:center;background:#0b111a;color:#edf3fc;font:16px system-ui;padding:24px;box-sizing:border-box"><section style="max-width:520px;padding:32px;border:1px solid #344657;border-radius:20px;background:#121d28"><p style="color:#f6df28;font-size:12px;letter-spacing:2px">TR-OS · ÅTKOMST SPÄRRAD</p><h1 style="font-size:28px">Webbläsaren är blockerad</h1><p>En sökning som bryter mot webbplatsens regler utlöste en automatisk spärr. Webbplatsens administratör kan häva den i adminpanelen.</p></section></main>';
  function showBlocked() {
    if (document.documentElement.dataset.trosModerationBlocked === 'true') return;
    document.documentElement.dataset.trosModerationBlocked = 'true';
    document.title = 'Åtkomst spärrad · TR-os';
    document.body.innerHTML = blockedMarkup;
  }
  async function flagAdultSearch() {
    const response = await fetch('/api/moderation/flag', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(8000)
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 403 && data.banned) { showBlocked(); return data; }
    if (!response.ok || !data.banned) throw new Error(data.error || 'Spärren kunde inte sparas just nu.');
    showBlocked();
    return data;
  }
  async function check() {
    try {
      const response = await fetch('/api/moderation/status', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (response.status === 403) {
        const data = await response.json().catch(() => ({}));
        if (data.banned) showBlocked();
      }
    } catch {}
  }
  window.TR_OS_MODERATION = Object.freeze({ flagAdultSearch, showBlocked, check });
  window.addEventListener('message', event => {
    if (event.origin === location.origin && event.data?.type === 'tr-os-moderation-banned') showBlocked();
  });
  if (window.top === window) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', check, { once: true });
    else check();
  }
})();
