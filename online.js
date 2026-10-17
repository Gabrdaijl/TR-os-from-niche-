(() => {
  function run() {
    let runtime = window.TR_OS;
    try { if (window.parent !== window && window.parent.TR_OS) runtime = window.parent.TR_OS; } catch {}
    if (!runtime?.presence) return;
    function show(data) {
      const el = document.getElementById('online');
      if (el) { el.textContent = typeof data.online === 'number' ? data.online : '—'; el.title = data.presence?.source === 'redis' ? 'Gemensamt antal aktiva webbläsare, senaste 90 sekunderna' : 'Gemensam besöksräkning är inte tillgänglig'; }
    }
    runtime.presence.subscribe(show);
    // Embedded pages share their parent heartbeat rather than creating sessions.
    if (runtime !== window.TR_OS || runtime.presence.started) return;
    runtime.presence.started = true;
    let pending = false;
    async function heartbeat() {
      if (pending) return;
      pending = true;
      try {
        let cached;
        try { cached = JSON.parse(localStorage.getItem('tros-presence-cache') || 'null'); } catch {}
        if (cached && Date.now() - cached.at < 25000) { runtime.presence.publish(cached.data); return; }
        await runtime.identity();
        let token, secret;
        try { token = localStorage.getItem('tros-online-id'); secret = localStorage.getItem('tros-online-secret'); } catch {}
        const response = await runtime.fetch('/online', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, secret, visitorId: await runtime.visitorId() }), signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw Error('Presence unavailable');
        const data = await response.json();
        try {
          if (data.token) localStorage.setItem('tros-online-id', data.token);
          if (data.secret) localStorage.setItem('tros-online-secret', data.secret);
          // Share only anonymous counts with other tabs, never session secrets.
          localStorage.setItem('tros-presence-cache', JSON.stringify({ at: Date.now(), data: { online: data.online, recentVisitors: data.recentVisitors, presence: data.presence } }));
        } catch {}
        runtime.presence.publish(data);
      } catch { runtime.presence.publish({ online: null, presence: { source: 'unavailable' } }); }
      finally { pending = false; }
    }
    heartbeat();
    const timer = setInterval(heartbeat, 30000);
    window.addEventListener('pagehide', () => clearInterval(timer));
    window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
    window.addEventListener('storage', event => {
      if (event.key === 'tros-presence-cache' && event.newValue) { try { runtime.presence.publish(JSON.parse(event.newValue).data); } catch {} }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
