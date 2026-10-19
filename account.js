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
      $('swish-qr').hidden = true;
      $('swish-qr').removeAttribute('src');
      $('create-payment').disabled = !current?.swishConfigured;
      $('payment-state').textContent = current?.swishConfigured ? '' : 'Automatisk Swish är inte ansluten ännu.';
      return;
    }
    if (payment.status === 'paid') {
      $('payment-instructions').hidden = true;
      $('create-payment').hidden = false;
      $('create-payment').disabled = !current?.swishConfigured;
      $('swish-qr').hidden = true;
      $('swish-qr').removeAttribute('src');
      $('payment-state').textContent = 'Swish har bekräftat betalningen. ' + payment.durationDays + ' dagar har lagts till automatiskt.';
      return;
    }
    if (payment.status === 'initiating') {
      $('payment-instructions').hidden = true;
      $('create-payment').hidden = true;
      $('swish-qr').hidden = true;
      $('swish-qr').removeAttribute('src');
      $('payment-state').textContent = 'Swish-betalningen startar. Vänta en stund.';
      return;
    }
    if (payment.status !== 'pending') {
      $('payment-instructions').hidden = true;
      $('create-payment').hidden = false;
      $('create-payment').disabled = !current?.swishConfigured;
      $('swish-qr').hidden = true;
      $('swish-qr').removeAttribute('src');
      $('payment-state').textContent = 'Swish-betalningen startar. Vänta en stund och ladda om sidan.';
      return;
    }
    $('create-payment').hidden = true;
    $('payment-instructions').hidden = false;
    $('payment-amount').textContent = payment.amount + ' kr';
    $('swish-number').textContent = swishNumber || '';
    $('payment-reference').textContent = payment.reference;
    $('swish-app').href = 'swish://paymentrequest?token=' + encodeURIComponent(payment.paymentToken || '');
    $('swish-qr').src = '/api/membership/payments/' + encodeURIComponent(payment.id) + '/qr';
    $('swish-qr').hidden = !payment.paymentToken;
    $('payment-state').textContent = 'Betalningskod ' + payment.reference + ' · Swish bekräftar betalningen automatiskt.';
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
      ? 'Åtkomsten har gått ut. Betala nästa månad med Swish så öppnas hemsidan igen automatiskt.'
      : freeTrial
        ? 'Din provperiod är aktiv till ' + formatDate(user.trialUntilMs) + '. Efter 3 dagar behöver du betala med Swish.'
        : 'Ditt medlemskap är aktivt.';
    $('open-site').hidden = !user.active;
    $('devices').textContent = 'Inloggning tillåten på en dator och en mobil. Aktiva platser: dator ' + (user.devices.computer ? 'upptagen' : 'ledig') + ', mobil ' + (user.devices.mobile ? 'upptagen' : 'ledig') + '.';
    const plans = Array.isArray(data.plans) ? data.plans : [];
    const plan = plans.find(item => item.id === user.planId);
    $('payment-copy').textContent = 'Nästa ' + (data.durationDays || plan?.durationDays || 30) + ' dagar kostar ' + (data.nextPrice ?? plan?.prices?.[Math.min(user.paidMonths, 2)] ?? '—') + ' kr. Swish verifierar betalningen automatiskt.';
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
    $('payment-state').textContent = 'Skapar betalningskod…';
    try { const result = await api('/api/membership/payments', { method: 'POST', body: '{}' }); showPayment(result.payment, result.swishNumber); }
    catch (error) { $('payment-state').textContent = error.message; $('create-payment').disabled = false; }
  });
  $('copy-payment').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('payment-reference').textContent);
      $('payment-state').textContent = 'Betalningsreferensen kopierades.';
    } catch { $('payment-state').textContent = 'Kopiering stöds inte här. Skriv av referensen.'; }
  });
  refresh().then(() => { if (current?.user && !timer) timer = setInterval(refresh, 20000); });
})();
