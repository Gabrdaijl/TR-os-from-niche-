(() => {
  const $ = id => document.getElementById(id);
  let authorization = '', timer, expires = 0, pending = false;
  function logout() {
    authorization = ''; clearInterval(timer); $('password').value = '';
    $('dashboard').hidden = true; $('cards').replaceChildren(); $('services').replaceChildren();
    $('login').hidden = false; $('logout').hidden = true;
  }
  async function refresh() {
    if (pending) return;
    if (!authorization || Date.now() >= expires) return logout();
    pending = true;
    try {
      const response = await fetch('/api/admin/status', { headers: { authorization }, cache: 'no-store', signal: AbortSignal.timeout(10000) });
      const data = await response.json();
      if (!response.ok) { logout(); throw Error(data.error || 'Status kunde inte hämtas'); }
      $('message').textContent = '';
      $('login').hidden = true; $('dashboard').hidden = false; $('logout').hidden = false;
      $('active-count').textContent = typeof data.activeSessions === 'number' ? data.activeSessions : '—';
      $('recent-count').textContent = typeof data.recentVisitors === 'number' ? data.recentVisitors : '—';
      const connected = data.presence?.source === 'redis';
      $('traffic-state').textContent = connected ? '● LIVE' : 'VÄNTAR';
      $('db-state').textContent = connected ? '● Live · Redis' : 'Databasen inte tillgänglig';
      $('db-state').className = connected ? 'state' : 'state warning';
      const metrics = [['WebSocket-anslutningar', data.websocketConnections], ['Drifttid', Math.floor(data.uptimeSeconds / 60) + ' min'], ['Anrop', data.requests], ['Serverfel (5xx)', data.serverErrors], ['Minne', data.memoryMB + ' MB']];
      $('cards').replaceChildren(...metrics.map(([label, value]) => {
        const card = document.createElement('div'); card.className = 'card';
        const title = document.createElement('h2'); title.textContent = label;
        const number = document.createElement('div'); number.className = 'number'; number.textContent = String(value);
        card.append(title, number); return card;
      }));
      const labels = { server: 'Server', database: 'Databas', proxy: 'Webbproxy', ai: 'AI-chatt', vpn: 'VPN-tunnel', movies: 'Filmer', cloud: 'Cloud gaming', chat: 'Chatt & närvaro' };
      $('services').replaceChildren(...Object.entries(data.services).map(([name, status]) => {
        const card = document.createElement('article'); card.className = 'service';
        const top = document.createElement('div'); top.className = 'service-top';
        const title = document.createElement('h3'); title.textContent = labels[name] || name;
        const pill = document.createElement('span'); pill.className = 'pill'; pill.textContent = 'Info';
        if (name === 'database') { pill.textContent = connected ? 'Ansluten' : 'Saknas'; pill.classList.add(connected ? 'ok' : 'warn'); }
        if (name === 'server') { pill.textContent = 'Tillgänglig'; pill.classList.add('ok'); }
        const description = document.createElement('p'); description.textContent = status;
        top.append(title, pill); card.append(top, description); return card;
      }));
      $('scope').textContent = data.scope;
      $('updated').textContent = 'Senast kontrollerad ' + new Date(data.checkedAt).toLocaleTimeString('sv-SE') + ' · uppdateras var 15:e sekund';
    } catch (error) { $('message').textContent = error.message; }
    finally { pending = false; }
  }
  $('login').addEventListener('submit', async event => {
    event.preventDefault();
    const bytes = new TextEncoder().encode('admin:' + $('password').value);
    authorization = 'Basic ' + btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
    $('password').value = ''; expires = Date.now() + 30 * 60000;
    clearInterval(timer); await refresh(); if (authorization && $('login').hidden) timer = setInterval(refresh, 15000);
  });
  $('logout').addEventListener('click', logout);
  $('refresh').addEventListener('click', refresh);
  window.addEventListener('pagehide', logout);
})();
