(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const frame = $('screen');
  let active, timer, liveOrigin, ending, releasePromise, forgetting = false, generation = 0, stopToken = '', authorization = '';
  try { $('remember').checked = localStorage.getItem('tros-snap-remember') === '1'; } catch {}
  const basicAuthorization = password => 'Basic ' + btoa(Array.from(new TextEncoder().encode('admin:' + password), byte => String.fromCharCode(byte)).join(''));
  function release() {
    if (releasePromise) return releasePromise;
    if (!stopToken || !authorization) return Promise.resolve(true);
    const headers = { authorization, 'x-tros-snap-stop': stopToken };
    stopToken = authorization = '';
    releasePromise = (async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await fetch('/api/admin/snapchat/stop', {
            method: 'POST', headers, keepalive: true, cache: 'no-store', credentials: 'same-origin'
          });
          if (response.ok) return true;
        } catch {}
      }
      return false;
    })();
    return releasePromise;
  }
  function finish(text) {
    if (ending) return ending;
    const operation = ++generation;
    const stopped = release();
    active?.abort();
    active = null;
    clearInterval(timer);
    frame.removeAttribute('src');
    frame.hidden = true;
    liveOrigin = '';
    $('countdown').textContent = '';
    $('stop').hidden = $('fullscreen').hidden = true;
    $('setup').hidden = false;
    $('start').disabled = $('forget').disabled = true;
    $('message').textContent = text;
    ending = stopped.then(ok => {
      if (generation === operation && !active) {
        ending = null;
        $('start').disabled = $('forget').disabled = false;
        $('message').textContent = ok ? text : 'Testvyn är stängd. Sessionen kunde inte stängas direkt och avslutas senast efter fyra minuter.';
      }
      return ok;
    });
    return ending;
  }
  function show(event, controller) {
    if (active !== controller || controller.signal.aborted) return;
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
      if (active !== controller || controller.signal.aborted) return;
      const seconds = Math.max(0, Math.ceil((Date.parse(event.expiresAt) - Date.now()) / 1000));
      $('countdown').textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
      if (!seconds) finish('Testtiden är slut. Sessionen stängs.');
    }, 1000);
  }
  $('start-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (active || ending || forgetting) return;
    generation++;
    releasePromise = null;
    active = new AbortController();
    const controller = active;
    $('start').disabled = true;
    $('stop').hidden = false;
    $('message').textContent = 'Startar en separat webbläsare…';
    try {
      authorization = basicAuthorization($('password').value);
      stopToken = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
      const remember = $('remember').checked;
      try { localStorage.setItem('tros-snap-remember', remember ? '1' : '0'); } catch {}
      $('password').value = '';
      const response = await fetch('/api/admin/snapchat', {
        method: 'POST', headers: { authorization, 'x-tros-snap-stop': stopToken, 'x-tros-snap-remember': remember ? '1' : '0' }, signal: controller.signal,
        cache: 'no-store', credentials: 'same-origin'
      });
      if (active !== controller || controller.signal.aborted) return;
      if (!response.ok) {
        if ([401, 403, 405].includes(response.status)) stopToken = authorization = '';
        const data = await response.json().catch(() => ({}));
        throw Error(data.error || 'Anslutningen kunde inte startas.');
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      while (!controller.signal.aborted) {
        const { done, value } = await reader.read();
        if (active !== controller || controller.signal.aborted) return;
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        const lines = pending.split('\n');
        pending = lines.pop();
        for (const line of lines) if (line.trim()) show(JSON.parse(line), controller);
      }
      if (active === controller) finish('Testet är avslutat.');
    } catch (error) {
      if (active === controller) finish(error.name === 'AbortError' ? 'Testet är avslutat.' : error.message);
    }
  });
  $('stop').onclick = () => finish('Testet är avslutat.');
  $('forget').onclick = async () => {
    if (active || ending || forgetting) return;
    if (!$('password').reportValidity()) return;
    if (!confirm('Ta bort den här enhetens sparade Snapchat-profil hos Browserbase permanent? Den sparade inloggningen går inte att återställa. Ditt Snapchat-konto tas inte bort.')) return;
    const operation = ++generation;
    forgetting = true;
    $('forget').disabled = $('start').disabled = true;
    try {
      const auth = basicAuthorization($('password').value);
      $('password').value = '';
      const response = await fetch('/api/admin/snapchat/forget', { method: 'POST', headers: { authorization: auth }, cache: 'no-store', credentials: 'same-origin' });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'Profilen kunde inte tas bort.');
      $('remember').checked = false;
      try { localStorage.removeItem('tros-snap-remember'); } catch {}
      $('message').textContent = 'Den här enhetens sparade profil är borttagen.';
    } catch (error) { $('message').textContent = error.message; }
    finally {
      forgetting = false;
      if (generation === operation && !active && !ending) $('forget').disabled = $('start').disabled = false;
    }
  };
  $('fullscreen').onclick = () => frame.requestFullscreen().catch(() => { $('message').textContent = 'Webbläsaren kunde inte aktivera fullskärm.'; });
  window.addEventListener('message', event => {
    if (event.source === frame.contentWindow && event.origin === liveOrigin && event.data === 'browserbase-disconnected') finish('Webbläsarsessionen har stängts.');
  });
  window.addEventListener('pagehide', () => { finish('Testvyn är stängd. Starta igen för att öppna din profil.'); });
})();
