'use strict';

(() => {
  const installButton = document.getElementById('install-button');
  const installOpen = document.getElementById('install-open');
  const dialog = document.getElementById('install-dialog');
  const instructions = document.getElementById('install-instructions');
  const confirmButton = document.getElementById('install-confirm');
  const doneButton = document.getElementById('install-done');
  let installPrompt = null;

  const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const closeDialog = () => {
    if (dialog.open) dialog.close();
  };
  const openDialog = () => {
    if (isInstalled()) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  };
  const showInstructions = () => {
    const isAppleMobile = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    instructions.innerHTML = isAppleMobile
      ? 'Tryck på <strong>Dela</strong> i webbläsaren och välj <strong>Lägg till på hemskärmen</strong>. Öppna sedan TR-os från den nya ikonen.'
      : 'Öppna webbläsarens meny och välj <strong>Installera app</strong> eller <strong>Lägg till på hemskärmen</strong>. Öppna sedan TR-os från den nya ikonen.';
    confirmButton.hidden = true;
  };

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    confirmButton.hidden = false;
    confirmButton.textContent = 'Installera TR-os';
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    document.getElementById('install-card').hidden = true;
    installOpen.hidden = true;
    closeDialog();
  });

  const onInstallClick = async () => {
    if (isInstalled()) return;
    showInstructions();
    openDialog();
    if (!installPrompt) return;
    confirmButton.hidden = false;
  };
  installButton.addEventListener('click', onInstallClick);
  installOpen.addEventListener('click', onInstallClick);
  confirmButton.addEventListener('click', async () => {
    if (!installPrompt) return showInstructions();
    const promptEvent = installPrompt;
    installPrompt = null;
    confirmButton.disabled = true;
    try {
      await promptEvent.prompt();
      await promptEvent.userChoice;
    } catch {
      showInstructions();
    } finally {
      confirmButton.disabled = false;
      if (!isInstalled()) confirmButton.hidden = true;
    }
  });
  doneButton.addEventListener('click', closeDialog);

  if (isInstalled()) {
    document.getElementById('install-card').hidden = true;
    installOpen.hidden = true;
  } else {
    showInstructions();
  }
})();
