(() => {
  'use strict';
  const blockedMarkup = '<main class="support-shell blocked-shell"><a class="support-brand" href="/" aria-label="TR-os"><span class="brand-mark">T</span><span>TR-os<small>Hjälpcenter</small></span></a><section class="block-card"><div class="block-icon" aria-hidden="true">!</div><p class="support-eyebrow">ÅTKOMST SPÄRRAD</p><h1>Webbläsaren är blockerad</h1><p class="block-reason"><strong>Anledning:</strong> Systemet har upptäckt sökningar efter pornografiskt eller annat sexuellt innehåll och blockerat webbläsaren automatiskt.</p><p class="block-help">Kontakta administratören så hjälper han dig med problemet.</p><section class="support-chat-card" aria-labelledby="moderation-chat-title"><div class="chat-heading"><div><p class="support-eyebrow">SUPPORT</p><h2 id="moderation-chat-title">Skriv till admin</h2></div><span class="chat-status"><i></i> Privat ärende</span></div><p class="chat-intro">Beskriv vad som hänt. Du kan fortsätta chatten även efter att spärren hävts.</p><div id="moderation-chat-messages" class="support-messages" role="log" aria-live="polite"></div><form id="moderation-chat-form" class="support-form"><label class="sr-only" for="moderation-chat-input">Ditt meddelande</label><textarea id="moderation-chat-input" maxlength="2000" required rows="3" placeholder="Skriv ditt meddelande…"></textarea><div class="support-form-bottom"><span id="moderation-chat-state" role="status" aria-live="polite"></span><button type="submit"><span>Skicka</span><span aria-hidden="true">↗</span></button></div></form><button id="moderation-push" class="push-opt-in" type="button">Få en notis när admin svarar</button><span id="moderation-push-state" class="push-state" role="status" aria-live="polite"></span><a class="support-link" href="/support.html">Öppna supportchatten senare <span aria-hidden="true">→</span></a></section></section><footer class="support-footer">TR-os · Hjälpcenter</footer></main>';
  let supportTimer;

  function setupPushButton() {
    const button = document.getElementById('moderation-push');
    const state = document.getElementById('moderation-push-state');
    if (!button || button.dataset.ready) return;
    button.dataset.ready = 'true';
    button.addEventListener('click', async () => {
      if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        if (state) state.textContent = 'Den här webbläsaren stöder inte pushnotiser.';
        return;
      }
      if (/iPhone|iPad|iPod/i.test(navigator.userAgent) && !navigator.standalone && !matchMedia('(display-mode: standalone)').matches) {
        if (state) state.textContent = 'På iPhone: lägg först TR-os på hemskärmen och öppna appen därifrån.';
        return;
      }
      button.disabled = true;
      if (state) state.textContent = 'Ansluter notiser…';
      try {
        const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
        if (permission !== 'granted') throw new Error('Tillåt notiser i enhetens inställningar för att få adminsvar.');
        const keyResponse = await fetch('/api/push/vapid-public', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000) });
        const keyData = await keyResponse.json();
        if (!keyResponse.ok || !keyData.publicKey) throw new Error(keyData.error || 'Pushnotiser är inte tillgängliga just nu.');
        const applicationServerKey = Uint8Array.from(atob(keyData.publicKey.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - keyData.publicKey.length % 4) % 4)), char => char.charCodeAt(0));
        const registration = await navigator.serviceWorker.register('/push-sw.js?v=20261020.1', { scope: '/push/' });
        const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
        const response = await fetch('/api/moderation/push/subscription', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: subscription.toJSON() }), signal: AbortSignal.timeout(8000) });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Notisinställningen kunde inte sparas.');
        button.textContent = 'Notiser aktiverade';
        if (state) state.textContent = 'Du får en enhetsnotis när administratören svarar.';
      } catch (error) {
        if (state) state.textContent = error.message;
      } finally { button.disabled = false; }
    });
  }

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
          const cards = messages.map(message => {
            const item = document.createElement('article');
            item.className = 'support-message' + (message.role === 'admin' ? ' from-admin' : '');
            const label = document.createElement('strong');
            label.textContent = message.role === 'admin' ? 'Administratören' : 'Du';
            const text = document.createElement('p'); text.textContent = message.text;
            const time = document.createElement('time'); time.dateTime = message.createdAt; time.textContent = new Date(message.createdAt).toLocaleString('sv-SE');
            item.append(label, text, time); return item;
          });
          if (!cards.length) {
            const empty = document.createElement('p'); empty.className = 'support-empty'; empty.textContent = 'Skriv här så får administratören ditt meddelande.'; cards.push(empty);
          }
          list.replaceChildren(...cards); list.scrollTop = list.scrollHeight;
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
    if (document.documentElement.dataset.trosModerationBlocked !== 'true') {
      document.documentElement.dataset.trosModerationBlocked = 'true';
      document.title = 'Webbläsaren är blockerad · TR-os';
      if (!document.querySelector('link[href^="/support.css"]')) {
        const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = '/support.css?v=20261020.1'; document.head.append(style);
      }
      document.body.innerHTML = blockedMarkup;
    }
    initSupportChat();
    setupPushButton();
  }

  async function flagAdultSearch() {
    const response = await fetch('/api/moderation/flag', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(8000) });
    const data = await response.json().catch(() => ({}));
    if (response.status === 403 && data.banned) { showBlocked(); return data; }
    if (!response.ok || !data.banned) throw new Error(data.error || 'Spärren kunde inte sparas just nu.');
    showBlocked(); return data;
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
  initSupportChat();
  setupPushButton();
  if (window.top === window) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', check, { once: true });
    else check();
  }
})();
