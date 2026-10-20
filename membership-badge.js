(() => {
  const link = document.getElementById('account-nav');
  const badge = document.getElementById('membership-time-badge');
  if (!link || !badge) return;

  let expiresAt = 0;
  let active = false;

  function update() {
    if (!expiresAt) return;
    const minutes = Math.max(0, Math.floor((expiresAt - Date.now()) / 60000));
    active = active && expiresAt > Date.now();
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor(minutes % 1440 / 60);
    const remainder = minutes % 60;
    const short = days ? `${days}d` : hours ? `${hours}h` : `${remainder}m`;
    const detail = `${days} dagar · ${hours} timmar · ${remainder} minuter`;
    badge.textContent = short;
    link.dataset.tip = active ? `Konto · ${detail} kvar` : 'Konto · åtkomsttiden har gått ut';
    link.setAttribute('aria-label', 'Konto. Återstående åtkomst: ' + detail + '. Öppna kontosidan för mer information.');
  }

  async function load() {
    try {
      const response = await fetch('/api/membership/me', { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) return;
      const data = await response.json();
      const user = data?.user;
      if (!user) return;
      expiresAt = Number(user.accessUntilMs) || 0;
      active = !!user.active && expiresAt > Date.now();
      update();
    } catch {}
  }

  load();
  window.setInterval(update, 60000);
  window.setInterval(load, 300000);
})();
