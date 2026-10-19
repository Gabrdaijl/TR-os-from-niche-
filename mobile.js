'use strict';

(() => {
  const apps = {
    home: { title: 'Home', src: '/n1browser27d.html' },
    games: { title: 'Games', src: '/n1chetesting2.html' },
    movies: { title: 'Movies', src: '/nm.html' },
    ai: { title: 'AI', src: '/nai.html' },
    snapchat: { title: 'Snapchat', src: '/snapchat.html?mobile=1' },
    cheats: { title: 'Cheats', src: '/join' },
    cloud: { title: 'Cloud', src: '/launcher.html' },
    settings: { title: 'Settings', src: '/settings.html' }
  };

  const frame = document.getElementById('mobile-frame');
  const title = document.getElementById('app-title');
  const navItems = [...document.querySelectorAll('.nav-item')];
  const moreDialog = document.getElementById('more-dialog');
  const installDialog = document.getElementById('install-dialog');
  const installInstructions = document.getElementById('install-instructions');
  const confirmButton = document.getElementById('install-confirm');
  let installPrompt = null;
  let currentPage = 'home';

  const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const closeDialog = dialog => { if (dialog?.open) dialog.close(); };

  function showPage(key, { updateHistory = false } = {}) {
    const app = apps[key] ? key : 'home';
    currentPage = app;
    const entry = apps[app];
    if (title) title.textContent = entry.title;
    if (frame && frame.getAttribute('src') !== entry.src) frame.setAttribute('src', entry.src);
    if (frame) frame.title = `TR-os ${entry.title}`;

    navItems.forEach(item => {
      const active = item.dataset.page === app;
      item.classList.toggle('is-active', active);
      if (active) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });

    if (updateHistory) {
      const hash = app === 'home' ? '' : `#${app}`;
      history.pushState({ trosMobilePage: app }, '', `${location.pathname}${location.search}${hash}`);
    }
  }

  document.querySelectorAll('[data-page]').forEach(button => {
    button.addEventListener('click', event => {
      if (event.currentTarget instanceof HTMLAnchorElement) event.preventDefault();
      const page = event.currentTarget.dataset.page;
      if (!apps[page]) return;
      closeDialog(moreDialog);
      showPage(page, { updateHistory: page !== currentPage });
    });
  });

  window.addEventListener('popstate', () => {
    const fromHash = location.hash.slice(1);
    showPage(apps[fromHash] ? fromHash : 'home');
  });

  document.getElementById('more-open')?.addEventListener('click', () => {
    if (typeof moreDialog?.showModal === 'function') moreDialog.showModal();
    else moreDialog?.setAttribute('open', '');
  });
  document.querySelectorAll('[data-close]').forEach(button => {
    button.addEventListener('click', () => closeDialog(document.getElementById(button.dataset.close)));
  });

  const showInstallInstructions = () => {
    const isAppleMobile = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!installInstructions) return;
    installInstructions.innerHTML = isAppleMobile
      ? 'Tryck på <strong>Dela</strong> i webbläsaren och välj <strong>Lägg till på hemskärmen</strong>. Öppna sedan TR-os från den nya ikonen.'
      : 'Öppna webbläsarens meny och välj <strong>Installera app</strong> eller <strong>Lägg till på hemskärmen</strong>.';
    if (confirmButton) confirmButton.hidden = !installPrompt;
  };

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    if (confirmButton) confirmButton.hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    const openButton = document.getElementById('install-open');
    if (openButton) openButton.hidden = true;
    closeDialog(installDialog);
  });

  document.getElementById('install-open')?.addEventListener('click', () => {
    if (isInstalled()) return;
    showInstallInstructions();
    if (typeof installDialog?.showModal === 'function') installDialog.showModal();
    else installDialog?.setAttribute('open', '');
  });
  confirmButton?.addEventListener('click', async () => {
    if (!installPrompt) return showInstallInstructions();
    const promptEvent = installPrompt;
    installPrompt = null;
    confirmButton.disabled = true;
    try {
      await promptEvent.prompt();
      await promptEvent.userChoice;
    } catch {
      showInstallInstructions();
    } finally {
      confirmButton.disabled = false;
      if (!isInstalled()) confirmButton.hidden = true;
    }
  });

  if (isInstalled()) {
    const openButton = document.getElementById('install-open');
    if (openButton) openButton.hidden = true;
  }
  showInstallInstructions();
  const initialPage = location.hash.slice(1);
  showPage(apps[initialPage] ? initialPage : 'home');
})();
