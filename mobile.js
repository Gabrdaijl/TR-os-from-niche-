'use strict';

(() => {
  const apps = {
    home: { title: 'Home', src: '/n1browser27d.html' },
    games: { title: 'Games', src: '/n1chetesting2.html' },
    movies: { title: 'Movies', src: '/nm.html' },
    ai: { title: 'AI', src: '/nai.html' },
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

  const themes = {
    dark: { bg: '#000000', card: '#111111', border: '#2b2b2b', text: '#ffffff', nav: '#161616', accent: '#ffffff', onAccent: '#000000' },
    halloween: { bg: '#0a0705', card: '#120c07', border: '#2e2114', text: '#f2dfc2', nav: '#1c130b', accent: '#d99a5f', onAccent: '#0a0a0a' },
    red: { bg: '#0d0807', card: '#150c0a', border: '#332019', text: '#f3e2d8', nav: '#211210', accent: '#d67f6d', onAccent: '#0a0a0a' },
    green: { bg: '#070a07', card: '#0c110b', border: '#232b20', text: '#e3e8d8', nav: '#151a13', accent: '#a3b18a', onAccent: '#0a0a0a' },
    white: { bg: '#f4f1ea', card: '#ffffff', border: '#e3ddd0', text: '#211d16', nav: '#ebe6da', accent: '#2f5d8a', onAccent: '#ffffff' },
    ocean: { bg: '#060b10', card: '#0a1218', border: '#1e3a4d', text: '#d8ecf5', nav: '#10202c', accent: '#5aa9e6', onAccent: '#06121a' }
  };
  const hasTheme = name => Object.prototype.hasOwnProperty.call(themes, name);

  function syncTheme(name) {
    if (name === 'light') name = 'ocean';
    const themeName = hasTheme(name) ? name : 'dark';
    const theme = themes[themeName];
    const root = document.documentElement;
    root.dataset.trosTheme = themeName;
    root.style.colorScheme = themeName === 'white' ? 'light' : 'dark';
    root.style.setProperty('--shell', theme.bg);
    root.style.setProperty('--stage', theme.bg);
    root.style.setProperty('--bar', theme.card);
    root.style.setProperty('--bar-border', theme.border);
    root.style.setProperty('--bar-ink', theme.text);
    root.style.setProperty('--bar-active', theme.accent);
    root.style.setProperty('--bar-active-ink', theme.onAccent);
    root.style.setProperty('--bar-control', theme.nav);
    root.style.setProperty('--dialog-bg', theme.card);
    root.style.setProperty('--dialog-line', theme.border);
    root.style.setProperty('--dialog-ink', theme.text);
    root.style.setProperty('--dialog-accent', theme.accent);
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.content = theme.card;

    try {
      if (frame?.contentWindow) {
        frame.contentWindow.postMessage({ trosTheme: themeName === 'ocean' ? 'ocean' : 'dark', trosThemeName: themeName }, location.origin);
      }
    } catch {}
  }

  function readTheme() {
    try { syncTheme(localStorage.getItem('tros-theme') || 'dark'); }
    catch { syncTheme('dark'); }
  }

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

  frame?.addEventListener('load', readTheme);
  window.addEventListener('storage', event => {
    if (event.key === 'tros-theme') syncTheme(event.newValue || 'dark');
  });
  window.addEventListener('message', event => {
    if (event.source !== frame?.contentWindow || event.origin !== location.origin) return;
    if (!event.data || typeof event.data !== 'object') return;
    if (hasTheme(event.data.trosThemeName)) syncTheme(event.data.trosThemeName);
    if (event.data.trosMobilePlayer === 'open') document.querySelector('.mobile-shell')?.classList.add('movie-player-open');
    if (event.data.trosMobilePlayer === 'close') document.querySelector('.mobile-shell')?.classList.remove('movie-player-open');
  });
  readTheme();

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
