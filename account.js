(() => {
  const $ = id => document.getElementById(id);
  let current = null, busy = false, timer = null;

  function deviceId() {
    try {
      let id = localStorage.getItem('tros-member-device');
      if (!/^[A-Za-z0-9_-]{32,64}$/.test(id || '')) {
        id = crypto.randomUUID().replaceAll('-', '');
        localStorage.setItem('tros-member-device', id);
      }
      return id;
    } catch {
      throw Error('Tillåt lokal lagring i webbläsaren och försök igen.');
    }
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      cache: 'no-store', credentials: 'same-origin', ...options,
      headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) }
    });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw Error(data.error || 'Något gick fel. Försök igen.');
    return data;
  }

  function formatDate(timestamp) {
    if (!timestamp) return 'Ingen tid tilldelad';
    return new Date(timestamp).toLocaleDateString('sv-SE', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function selectTab(register) {
    $('tab-login').setAttribute('aria-selected', String(!register));
    $('tab-register').setAttribute('aria-selected', String(register));
    $('login-form').hidden = register;
    $('register-form').hidden = !register;
    $('auth-title').textContent = register ? 'Skapa konto' : 'Logga in';
    $('auth-copy').textContent = register
      ? 'Skapa ett TR-os-konto. Administratören lägger till åtkomsttid.'
      : 'Använd e-postadressen och lösenordet för ditt konto.';
    $('notice').textContent = '';
  }

  function render(data) {
    current = data;
    const user = data.user;
    $('auth-panel').hidden = !!user;
    $('member-panel').hidden = !user;
    if (!user) {
      $('auth-state').textContent = '';
      const status = new URLSearchParams(location.search).get('status');
      if (status === 'expired') $('notice').textContent = 'Din åtkomst har gått ut. Logga in för att se kontot och be administratören om mer tid.';
      else if (status === 'login') $('notice').textContent = 'Logga in eller skapa ett konto för att öppna TR-os.';
      return;
    }

    $('member-title').textContent = 'Hej, ' + user.firstName + '!';
    $('days-left').textContent = user.active ? user.daysLeft + (user.daysLeft === 1 ? ' dag' : ' dagar') : '0 dagar';
    $('access-until').textContent = formatDate(user.accessUntilMs);
    $('member-state').classList.toggle('expired', !user.active);
    $('member-state').classList.toggle('waiting', !user.active && !user.accessUntilMs);
    $('member-state').textContent = user.active
      ? 'Din åtkomst är aktiv. Du kan öppna hemsidan nu.'
      : user.accessUntilMs
        ? 'Din åtkomst gick ut ' + formatDate(user.accessUntilMs) + '. Kontakta administratören för att få mer tid.'
        : 'Ingen åtkomsttid har lagts till ännu. Kontakta administratören när ditt konto ska öppnas.';
    $('open-site').hidden = !user.active;
    $('member-help').hidden = user.active;
    $('devices').textContent = 'Tillåtna enheter: en dator och en mobil. Aktiva platser: dator ' + (user.devices.computer ? 'upptagen' : 'ledig') + ', mobil ' + (user.devices.mobile ? 'upptagen' : 'ledig') + '.';
  }

  async function refresh() {
    try { render(await api('/api/membership/me')); }
    catch (error) { $('notice').textContent = error.message; }
  }

  async function authenticate(event, mode) {
    event.preventDefault();
    if (busy) return;
    busy = true;
    const button = event.currentTarget.querySelector('button[type=submit]');
    const defaultText = button.querySelector('span')?.textContent || button.textContent;
    button.disabled = true;
    button.querySelector('span')?.replaceChildren(document.createTextNode(mode === 'login' ? 'Loggar in…' : 'Skapar konto…'));
    $('auth-state').textContent = 'Vänta lite…';
    const data = {
      email: $(mode === 'login' ? 'login-email' : 'register-email').value.trim(),
      password: $(mode === 'login' ? 'login-password' : 'register-password').value
    };
    if (mode === 'register') {
      data.firstName = $('first-name').value.trim();
      data.lastName = $('last-name').value.trim();
    }
    try {
      data.deviceId = deviceId();
      await api('/api/membership/' + mode, { method: 'POST', body: JSON.stringify(data) });
      $('login-password').value = '';
      $('register-password').value = '';
      history.replaceState(null, '', '/account.html');
      await refresh();
      if (!timer) timer = setInterval(refresh, 20000);
    } catch (error) {
      $('auth-state').textContent = error.message;
    } finally {
      button.disabled = false;
      const label = button.querySelector('span');
      if (label) label.textContent = defaultText;
      busy = false;
    }
  }

  $('tab-login').addEventListener('click', () => selectTab(false));
  $('tab-register').addEventListener('click', () => selectTab(true));
  $('login-form').addEventListener('submit', event => authenticate(event, 'login'));
  $('register-form').addEventListener('submit', event => authenticate(event, 'register'));
  document.querySelectorAll('[data-password-toggle]').forEach(button => button.addEventListener('click', () => {
    const input = $(button.dataset.passwordToggle);
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    button.textContent = reveal ? 'Dölj' : 'Visa';
    button.setAttribute('aria-label', reveal ? 'Dölj lösenord' : 'Visa lösenord');
    button.setAttribute('aria-pressed', String(reveal));
  }));
  $('logout').addEventListener('click', async () => {
    try { await api('/api/membership/logout', { method: 'POST', body: '{}' }); }
    catch (error) { $('member-state').textContent = error.message; return; }
    current = null;
    await refresh();
    if (timer) { clearInterval(timer); timer = null; }
  });

  refresh().then(() => { if (current?.user && !timer) timer = setInterval(refresh, 20000); });
})();
