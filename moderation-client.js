(() => {
  'use strict';
  const blockedMarkup = '<main style="min-height:100vh;background:#0b111a;color:#edf3fc;font:16px system-ui;padding:24px;box-sizing:border-box"><section style="max-width:720px;margin:6vh auto;padding:clamp(22px,5vw,38px);border:1px solid #344657;border-radius:20px;background:#121d28"><p style="color:#f6df28;font-size:12px;letter-spacing:2px">TR-OS · ÅTKOMST SPÄRRAD</p><h1 style="font-size:28px">Webbläsaren är blockerad</h1><p><strong>Anledning:</strong> Systemet har upptäckt sökningar efter pornografiskt eller annat sexuellt innehåll och blockerat webbläsaren automatiskt.</p><p>Kontakta administratören så hjälper han dig med problemet.</p><section id="moderation-chat" style="margin-top:28px;padding-top:20px;border-top:1px solid #344657"><h2 style="font-size:18px">Meddelande till administratören</h2><div id="moderation-chat-messages" role="log" aria-live="polite" style="max-height:300px;overflow:auto;display:grid;gap:9px;margin:14px 0"></div><form id="moderation-chat-form" style="display:grid;gap:10px"><label for="moderation-chat-input">Skriv ett meddelande</label><textarea id="moderation-chat-input" maxlength="2000" required rows="3" style="resize:vertical;padding:12px;border-radius:10px;background:#0b111a;color:#edf3fc;border:1px solid #344657;font:inherit"></textarea><button style="justify-self:start;padding:11px 16px;border-radius:9px;border:0;background:#f6df28;color:#171717;font:600 14px system-ui;cursor:pointer">Skicka till administratören</button><span id="moderation-chat-state" role="status" style="color:#aab8c8;font-size:13px"></span></form></section></section></main>';
  let supportTimer;
  function initSupportChat() {
    const form = document.getElementById('moderation-chat-form');
    const list = document.getElementById('moderation-chat-messages');
    const state = document.getElementById('moderation-chat-state');
    if (!form || !list || form.dataset.ready) return;
    form.dataset.ready = 'true';
    async function refreshMessages() {
      try {
        const response = await fetch('/api/moderation/messages', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000) });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Meddelandena kunde inte hämtas.');
        const messages = Array.isArray(data.messages) ? data.messages : [];
        const signature = JSON.stringify(messages);
        if (list.dataset.signature !== signature) {
          list.dataset.signature = signature;
          list.replaceChildren(...messages.map(message => {
            const item = document.createElement('article');
            item.style.cssText = 'padding:11px 13px;border:1px solid #344657;border-radius:11px;background:#0b111a;overflow-wrap:anywhere';
            const label = document.createElement('strong');
            label.textContent = message.role === 'admin' ? 'Administratören' : 'Du';
            const text = document.createElement('p');
            text.textContent = message.text;
            text.style.cssText = 'white-space:pre-wrap;margin:7px 0 0;line-height:1.5';
            item.append(label, text); return item;
          }));
          list.scrollTop = list.scrollHeight;
        }
        if (state) state.textContent = '';
      } catch (error) { if (state) state.textContent = error.message; }
    }
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const input = document.getElementById('moderation-chat-input');
      const button = form.querySelector('button');
      const text = input.value.trim();
      if (!text) return;
      button.disabled = true;
      if (state) state.textContent = 'Skickar…';
      try {
        const response = await fetch('/api/moderation/messages', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(10000) });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Meddelandet kunde inte skickas.');
        input.value = ''; await refreshMessages();
        if (state) state.textContent = 'Meddelandet skickades.';
      } catch (error) { if (state) state.textContent = error.message; }
      finally { button.disabled = false; }
    });
    refreshMessages();
    clearInterval(supportTimer);
    supportTimer = setInterval(refreshMessages, 5000);
  }
  function showBlocked() {
    if (document.documentElement.dataset.trosModerationBlocked === 'true') return;
    document.documentElement.dataset.trosModerationBlocked = 'true';
    document.title = 'Webbläsaren är blockerad · TR-os';
    document.body.innerHTML = blockedMarkup;
    initSupportChat();
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
