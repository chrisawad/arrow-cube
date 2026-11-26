/** Installation remains browser-controlled; help is available even without a prompt. */
export function setupInstall(button, notify = () => {}, { production = import.meta.env?.PROD === true } = {}) {
  const helpButton = document.getElementById('install-help');
  const helpDialog = document.getElementById('install-dialog');
  const dialogButton = document.getElementById('install-confirm');
  const status = document.getElementById('install-status');
  const guidance = document.getElementById('install-guidance');
  const linkPanel = document.getElementById('install-link-panel');
  const gameLink = document.getElementById('install-link');
  const offlineStatus = document.getElementById('install-offline');
  const mainButton = document.getElementById('install-main');
  const mainHelp = document.getElementById('install-main-help');
  const promo = document.getElementById('install-promo');
  const promoDetail = document.getElementById('install-promo-detail');
  const entryHelp = document.getElementById('install-entry-help');
  const entryGuidance = document.getElementById('install-entry-guidance');
  const entryLink = document.getElementById('install-entry-link');
  const buttons = [button, dialogButton, mainButton].filter(Boolean);
  const secure = window.isSecureContext === true;
  const embedded = window.self !== window.top;
  const modernInstall = secure && !embedded && typeof navigator.install === 'function';
  const userAgent = navigator.userAgent || '';
  const android = navigator.userAgentData?.platform === 'Android' || /Android/i.test(userAgent);
  const appleMobile = /iPhone|iPad|iPod/.test(userAgent) || navigator.standalone === true
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const fromDashboard = new URLSearchParams(window.location.hash.slice(1)).get('from') === 'games-dashboard'
    || /^https:\/\/(?:games\.chrisawad\.com(?:\/|$)|chrisawad\.github\.io\/games-dashboard(?:[/?#]|$))/i.test(document.referrer);
  const inApp = embedded || fromDashboard || /\bwv\b|FBAN\/|FBAV\/|Instagram|GSA\/|TikTok|Line\//i.test(userAgent);
  // Some in-app tabs have the same user agent as the mobile browser.
  const showEntryHelp = inApp || android || appleMobile;
  const launchInstructions = android
    ? 'Swipe up from your Home Screen to open the app drawer. Search for Arrow Cube, then tap it to play.'
    : appleMobile ? 'Find Arrow Cube on your Home Screen and tap it to play.'
      : 'Find Arrow Cube in your device’s app launcher or your browser’s installed apps.';
  const installInstructions = android
    ? 'In the in-app browser menu, choose Open in Chrome or Open in browser. If that option is missing, press and hold the game link below to copy it, then paste it into Chrome. In Chrome, open the ⋮ menu and look for Install, Install and create shortcut, or Add to home screen. If Arrow Cube is already installed, swipe up from your Home Screen and search for it in the app drawer.'
    : appleMobile
      ? 'In the in-app browser menu, choose Open in Safari if available. Otherwise copy the game link below and paste it into Safari. In Safari, tap Share, then Add to Home Screen. Turn on Open as Web App if you see it, then tap Add.'
      : 'Open the game in a full browser. Look for the Install icon in the address bar or check the browser menu for Install page as app in Chrome or Apps in Edge.';
  const publicURL = document.getElementById('public-game-url')?.href;
  if (gameLink && publicURL) gameLink.value = publicURL;
  if (entryLink && publicURL) entryLink.value = publicURL;
  if (entryGuidance) entryGuidance.textContent = installInstructions;
  const controller = new AbortController();
  const options = { signal: controller.signal };
  let deferredPrompt = null, pending = false, accepted = false, message = '';
  const appDisplay = globalThis.matchMedia?.('(display-mode: standalone)');
  // A dashboard window can carry its own display mode into this page.
  const inOwnAppWindow = () => !inApp && (appDisplay?.matches || navigator.standalone === true);
  let installed = inOwnAppWindow();
  let offline = !secure ? 'Offline play needs a secure connection.'
    : !production ? 'Offline play is not enabled for this preview. Use the full app address for offline play.'
      : !('serviceWorker' in navigator) ? 'This browser does not provide offline app support.' : 'Preparing offline play…';

  function update() {
    const ready = secure && !embedded && !installed && (pending || modernInstall || deferredPrompt !== null);
    for (const control of buttons) {
      control.hidden = !ready;
      if (pending) control.setAttribute('aria-disabled', 'true');
      else control.removeAttribute('aria-disabled');
    }
    if (entryHelp) entryHelp.hidden = installed || !showEntryHelp;
    if (promo) promo.hidden = installed || (showEntryHelp && !ready);
    if (mainHelp) mainHelp.hidden = installed || ready || showEntryHelp;
    if (linkPanel) linkPanel.hidden = installed || !publicURL;
    if (promoDetail) promoDetail.textContent = pending ? 'Finish in your browser.'
      : accepted ? 'Finish the browser confirmation.'
        : !secure ? 'Use a secure link to install.'
          : embedded ? 'Install from your browser.' : 'Full screen. Play offline.';
    if (promo && promoDetail) promo.title = promoDetail.textContent;
    let title;
    let detail = installInstructions;
    if (installed) {
      title = 'Arrow Cube is installed or running as an app.';
      detail = launchInstructions;
    } else if (!secure) {
      title = 'This address cannot offer app installation.';
      detail = `Use the public HTTPS game link below. ${installInstructions}`;
    } else if (embedded) {
      title = 'Open the game directly in a browser.';
    } else if (pending) {
      title = 'Continue in your browser’s install prompt.';
    } else if (ready) {
      title = 'Your browser is ready to install Arrow Cube.';
    } else if (accepted) {
      title = 'The browser accepted your install request.';
      detail = `Finish any remaining browser confirmation. ${installInstructions}`;
    } else {
      title = 'Your browser has not offered an install prompt.';
    }
    if (status) status.textContent = message || title;
    if (guidance) guidance.textContent = detail;
    if (offlineStatus) offlineStatus.textContent = offline;
  }
  function announce(text) { message = text; update(); notify(text); }
  // Initialize once per visit; asynchronous browser events must not reopen it.
  if (entryHelp) entryHelp.open = showEntryHelp && !installed;
  update();
  function openHelp() {
    update();
    if (helpDialog && !helpDialog.open) helpDialog.showModal();
  }
  for (const control of [helpButton, mainHelp].filter(Boolean)) control.addEventListener('click', openHelp, options);
  appDisplay?.addEventListener?.('change', event => {
    if (!inApp && event.matches) { installed = true; deferredPrompt = null; update(); }
  }, options);
  window.addEventListener('pageshow', () => {
    if (inOwnAppWindow()) { installed = true; deferredPrompt = null; }
    update();
  }, options);
  window.addEventListener('beforeinstallprompt', event => {
    if (!secure || embedded || installed) return;
    event.preventDefault();
    deferredPrompt = event; accepted = false; message = ''; update();
  }, options);
  window.addEventListener('appinstalled', () => {
    installed = true; deferredPrompt = null; accepted = false;
    announce('Arrow Cube is installed.');
  }, options);

  async function install() {
    if (pending || installed || !secure || embedded || (!modernInstall && !deferredPrompt)) return;
    pending = true; message = ''; update();
    try {
      if (modernInstall) {
        // Call before any await so browser-controlled consent retains the click activation.
        await navigator.install();
        if (controller.signal.aborted) return;
        installed = true;
        announce('Arrow Cube was installed or opened.');
      } else {
        // The captured event is single-use, including after dismissal or a failure.
        const prompt = deferredPrompt;
        deferredPrompt = null;
        const prompting = prompt.prompt();
        update();
        await prompting;
        const choice = await prompt.userChoice;
        if (controller.signal.aborted) return;
        if (!installed) {
          accepted = choice.outcome === 'accepted';
          announce(accepted ? 'Install request accepted. Finish any browser confirmation.'
            : 'Installation canceled. Choose How to install for other options.');
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (!installed) announce(error?.name === 'AbortError'
        ? 'Installation was canceled or could not complete. You can keep playing here.'
        : 'Installation could not start. Try again when your browser offers it, or check its app-install option.');
      if (error?.name !== 'AbortError') console.warn('Installation could not start.', error);
    } finally { pending = false; if (!controller.signal.aborted) update(); }
  }
  for (const control of buttons) control.addEventListener('click', install, options);

  // Keep the default worker lifecycle: no forced reload during an active puzzle.
  if (production && secure && 'serviceWorker' in navigator) {
    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register('./sw.js');
        if (controller.signal.aborted) return;
        const watch = () => {
          const worker = registration.installing || registration.waiting || registration.active;
          const check = () => {
            if (controller.signal.aborted) return;
            if (registration.active?.state === 'activated' || worker?.state === 'activated') offline = 'Offline play is ready on this device.';
            else if (worker?.state === 'redundant') offline = 'Offline setup could not finish. You can keep playing online.';
            update();
          };
          worker?.addEventListener('statechange', check, options);
          check();
        };
        registration.addEventListener('updatefound', watch, options);
        watch();
      } catch (error) {
        if (controller.signal.aborted) return;
        console.warn('Offline mode could not be enabled.', error);
        offline = 'Offline setup could not finish. You can keep playing online.';
        update();
      }
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true, signal: controller.signal });
  }
  return () => controller.abort();
}
