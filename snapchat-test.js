(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const frame = $('screen');
  let active, timer, liveOrigin;
  function finish(text) {
    active?.abort();
    active = null;
    clearInterval(timer);
    frame.removeAttribute('src');
    frame.hidden = true;
    liveOrigin = '';
    $('countdown').textContent = '';
    $('stop').hidden = $('fullscreen').hidden = true;
    $('setup').hidden = false;
    $('start').disabled = false;
    $('message').textContent = text;
  }
  function show(event) {
    if (event.type === 'error') throw Error(event.error || event.message || 'Testet kunde inte startas.');
    if (event.type === 'ended') { finish(event.message || 'Testet är avslutat.'); return; }
    if (event.type !== 'ready') return;
    const url = new URL(event.url);
    if (url.protocol !== 'https:' || !(url.hostname === 'browserbase.com' || url.hostname.endsWith('.browserbase.com'))) throw Error('Ogiltig webbläsaranslutning.');
    liveOrigin = url.origin;
    frame.src = url.href;
    frame.hidden = false;
    $('setup').hidden = true;
    $('stop').hidden = $('fullscreen').hidden = false;
    $('message').textContent = 'Logga in direkt i Snapchat-rutan. Testet är begränsat till fyra minuter.';
    timer = setInterval(() => {
      const seconds = Math.max(0, Math.ceil((Date.parse(event.expiresAt) - Date.now()) / 1000));
      $('countdown').textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
      if (!seconds) finish('Testtiden är slut. Sessionen stängs.');
    }, 1000);
  }
  $('start-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (active) return;
    active = new AbortController();
    const controller = active;
    $('start').disabled = true;
    $('stop').hidden = false;
    $('message').textContent = 'Startar en separat webbläsare…';
    const authorization = 'Basic ' + btoa('admin:' + $('password').value);
    $('password').value = '';
    try {
      const response = await fetch('/api/admin/snapchat', {
        method: 'POST', headers: { authorization }, signal: controller.signal,
        cache: 'no-store', credentials: 'same-origin'
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw Error(data.error || 'Anslutningen kunde inte startas.');
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      while (!controller.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        const lines = pending.split('\n');
        pending = lines.pop();
        for (const line of lines) if (line.trim()) show(JSON.parse(line));
      }
      if (active === controller) finish('Testet är avslutat.');
    } catch (error) {
      if (active === controller) finish(error.name === 'AbortError' ? 'Testet är avslutat.' : error.message);
    }
  });
  $('stop').onclick = () => finish('Testet är avslutat.');
  $('fullscreen').onclick = () => frame.requestFullscreen().catch(() => { $('message').textContent = 'Webbläsaren kunde inte aktivera fullskärm.'; });
  window.addEventListener('message', event => {
    if (event.source === frame.contentWindow && event.origin === liveOrigin && event.data === 'browserbase-disconnected') finish('Webbläsarsessionen har stängts.');
  });
  window.addEventListener('pagehide', () => active?.abort());
})();
