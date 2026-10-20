(() => {
  const $ = id => document.getElementById(id);
  let current = null, currentPayment = null, busy = false, timer = null;
  function deviceId() {
    try {
      let id = localStorage.getItem('tros-member-device');
      if (!/^[A-Za-z0-9_-]{32,64}$/.test(id || '')) { id = crypto.randomUUID().replaceAll('-', ''); localStorage.setItem('tros-member-device', id); }
      return id;
    } catch { throw Error('Webbläsaren måste tillåta lokal lagring för att komma ihåg enheten.'); }
  }
  async function api(path, options = {}) {
    const response = await fetch(path, { cache: 'no-store', credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) } });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw Error(data.error || 'Något gick fel. Försök igen.');
    return data;
  }
  function showError(message) { $('notice').textContent = message || ''; }
  function formatDate(timestamp) {
    if (!timestamp) return '—';
    return new Date(timestamp).toLocaleDateString('sv-SE', { year: 'numeric', month: 'long', day: 'numeric' });
  }
  function selectTab(register) {
    $('tab-login').setAttribute('aria-selected', String(!register));
    $('tab-register').setAttribute('aria-selected', String(register));
    $('login-form').hidden = register;
    $('register-form').hidden = !register;
    $('auth-title').textContent = register ? 'Skapa konto' : 'Logga in';
    showError('');
  }
  function showPayment(payment, swishNumber) {
    currentPayment = payment;
    if (!payment) {
      $('payment-instructions').hidden = true;
      $('create-payment').hidden = false;
      $('create-payment').disabled = false;
      $('payment-state').textContent = '';
      return;
    }
    if (payment.status === 'paid') {
      $('payment-instructions').hidden = true;
      $('create-payment').hidden = false;
      $('create-payment').disabled = false;
      $('payment-state').textContent = 'Din betalning är bekräftad. ' + payment.durationDays + ' dagar har lagts till.';
      return;
    }
    if (payment.status === 'pending' && payment.paidRequested) {
      $('payment-instructions').hidden = true;
      $('create-payment').hidden = true;
      $('payment-state').textContent = 'Din betalning är anmäld och väntar på att admin ska kontrollera och godkänna den.';
      return;
    }
    if (payment.status !== 'pending') {
      $('payment-instructions').hidden = true;
      $('create-payment').hidden = false;
      $('create-payment').disabled = false;
      $('payment-state').textContent = 'Skapa nya betalningsuppgifter för att försöka igen.';
      return;
    }
    $('create-payment').hidden = true;
    $('payment-instructions').hidden = false;
    $('payment-amount').textContent = payment.amount + ' kr';
    $('swish-number').textContent = swishNumber || '';
    $('payment-reference').textContent = payment.reference;
    $('payment-state').textContent = 'Betalningsreferens ' + payment.reference + '. Anmäl betalningen efter att du har swishat.';
  }
  function render(data) {
    current = data;
    const user = data.user;
    $('auth-panel').hidden = !!user;
    $('member-panel').hidden = !user;
    if (!user) {
      $('auth-state').textContent = '';
      if (new URLSearchParams(location.search).get('status') === 'expired') showError('Din åtkomst har gått ut. Logga in och betala för att fortsätta.');
      else if (new URLSearchParams(location.search).get('status') === 'login') showError('Logga in eller skapa ett konto för att öppna hemsidan.');
      return;
    }
    showError('');
    $('member-title').textContent = 'Hej, ' + user.firstName + '!';
    $('plan-name').textContent = user.planName;
    $('days-left').textContent = user.active ? user.daysLeft + (user.daysLeft === 1 ? ' dag' : ' dagar') : '0 dagar';
    $('access-until').textContent = formatDate(user.accessUntilMs);
    const freeTrial = user.trialUntilMs > Date.now() && user.paidUntilMs <= Date.now();
    $('member-state').classList.toggle('expired', !user.active);
    $('member-state').textContent = !user.active
      ? 'Åtkomsten har gått ut. Swisha nästa månad och anmäl betalningen. Admin öppnar åtkomsten när betalningen har godkänts.'
      : freeTrial
        ? 'Din provperiod är aktiv till ' + formatDate(user.trialUntilMs) + '. Efter 3 dagar behöver du betala med Swish.'
        : 'Ditt medlemskap är aktivt.';
    $('open-site').hidden = !user.active;
    $('devices').textContent = 'Inloggning tillåten på en dator och en mobil. Aktiva platser: dator ' + (user.devices.computer ? 'upptagen' : 'ledig') + ', mobil ' + (user.devices.mobile ? 'upptagen' : 'ledig') + '.';
    const plans = Array.isArray(data.plans) ? data.plans : [];
    const plan = plans.find(item => item.id === user.planId);
    $('payment-copy').textContent = 'Nästa ' + (data.durationDays || plan?.durationDays || 30) + ' dagar kostar ' + (data.nextPrice ?? plan?.prices?.[Math.min(user.paidMonths, 2)] ?? '—') + ' kr. Admin kontrollerar varje betalning innan åtkomsten förlängs.';
    $('payment-instructions').hidden = true;
    $('create-payment').hidden = false;
    showPayment(data.pendingPayment || data.latestPayment, data.swishNumber);
  }
  async function refresh() {
    try { render(await api('/api/membership/me')); }
    catch (error) { showError(error.message); }
  }
  async function authenticate(event, mode) {
    event.preventDefault();
    if (busy) return;
    busy = true;
    const button = event.currentTarget.querySelector('button[type=submit]');
    button.disabled = true;
    $('auth-state').textContent = 'Vänta…';
    const data = { email: $(mode === 'login' ? 'login-email' : 'register-email').value.trim(), password: $(mode === 'login' ? 'login-password' : 'register-password').value, deviceId: deviceId() };
    if (mode === 'register') { data.firstName = $('first-name').value.trim(); data.lastName = $('last-name').value.trim(); }
    try {
      await api('/api/membership/' + mode, { method: 'POST', body: JSON.stringify(data) });
      $('login-password').value = '';
      $('register-password').value = '';
      history.replaceState(null, '', '/account.html');
      await refresh();
      if (!timer) timer = setInterval(refresh, 20000);
    } catch (error) { $('auth-state').textContent = error.message; }
    finally { button.disabled = false; busy = false; }
  }
  $('tab-login').addEventListener('click', () => selectTab(false));
  $('tab-register').addEventListener('click', () => selectTab(true));
  $('login-form').addEventListener('submit', event => authenticate(event, 'login'));
  $('register-form').addEventListener('submit', event => authenticate(event, 'register'));
  $('logout').addEventListener('click', async () => {
    try { await api('/api/membership/logout', { method: 'POST', body: '{}' }); }
    catch (error) { $('payment-state').textContent = error.message; }
    current = null; currentPayment = null; await refresh();
    if (timer) { clearInterval(timer); timer = null; }
  });
  $('create-payment').addEventListener('click', async () => {
    $('create-payment').disabled = true;
    $('payment-state').textContent = 'Hämtar betalningsuppgifter…';
    try { const result = await api('/api/membership/payments', { method: 'POST', body: '{}' }); showPayment(result.payment, result.swishNumber); }
    catch (error) { $('payment-state').textContent = error.message; $('create-payment').disabled = false; }
  });
  $('report-payment-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!currentPayment || currentPayment.status !== 'pending') return;
    const form = event.currentTarget, button = form.querySelector('button[type=submit]');
    button.disabled = true; button.textContent = 'Skickar anmälan…';
    const data = { reference: currentPayment.reference, firstName: $('payer-first-name').value.trim(), lastName: $('payer-last-name').value.trim() };
    try {
      await api('/api/membership/payments/' + encodeURIComponent(currentPayment.id) + '/report', { method: 'POST', body: JSON.stringify(data) });
      form.reset(); await refresh();
    } catch (error) { $('payment-state').textContent = error.message; }
    finally { button.disabled = false; button.textContent = 'Jag har swishat'; }
  });
  $('copy-payment').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText('Swishnummer: ' + $('swish-number').textContent + '\nBelopp: ' + $('payment-amount').textContent + '\nMeddelande: ' + $('payment-reference').textContent);
      $('payment-state').textContent = 'Swishnummer, belopp och referens kopierades.';
    } catch { $('payment-state').textContent = 'Kopiering stöds inte här. Skriv av Swishnumret, beloppet och referensen.'; }
  });
  refresh().then(() => { if (current?.user && !timer) timer = setInterval(refresh, 20000); });
})();
