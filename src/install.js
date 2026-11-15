/** Installation remains browser-controlled; help is available even without a prompt. */
export function setupInstall(button, notify = () => {}, { production = import.meta.env?.PROD === true } = {}) {
  const helpButton = document.getElementById('install-help');
  const helpDialog = document.getElementById('install-dialog');
  const dialogButton = document.getElementById('install-confirm');
  const status = document.getElementById('install-status');
  const guidance = document.getElementById('install-guidance');
  const offlineStatus = document.getElementById('install-offline');
  const mainButton = document.getElementById('install-main');
  const mainHelp = document.getElementById('install-main-help');
  const promo = document.getElementById('install-promo');
  const promoDetail = document.getElementById('install-promo-detail');
  const buttons = [button, dialogButton, mainButton].filter(Boolean);
  const secure = window.isSecureContext === true;
  const embedded = window.self !== window.top;
  const modernInstall = secure && !embedded && typeof navigator.install === 'function';
  const controller = new AbortController();
  const options = { signal: controller.signal };
  let deferredPrompt = null, pending = false, accepted = false, message = '';
  const appDisplay = globalThis.matchMedia?.('(display-mode: standalone)');
  let installed = appDisplay?.matches || navigator.standalone === true;
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
    if (helpButton) helpButton.hidden = installed || ready;
    if (promo) promo.hidden = installed;
    if (mainHelp) mainHelp.hidden = installed || ready;
    if (promoDetail) promoDetail.textContent = pending ? 'Finish in your browser.'
      : accepted ? 'Finish the browser confirmation.'
        : !secure ? 'Use a secure link to install.'
          : embedded ? 'Install from your browser.' : 'Full screen. Play offline.';
    if (promo && promoDetail) promo.title = promoDetail.textContent;
    let title, detail;
    if (installed) {
      title = 'Arrow Cube is installed or running as an app.';
      detail = 'Open it from your device’s apps whenever you want to play.';
    } else if (!secure) {
      title = 'This address cannot offer app installation.';
      detail = 'Open the game at an HTTPS address in your regular browser. A localhost address also works on the computer serving the game. Plain HTTP over your local network does not support app installation.';
    } else if (embedded) {
      title = 'Open the game directly in a browser.';
      detail = 'App previews and embedded pages may not offer installation. Open this address in a full browser such as Chrome or Edge, then look for its app-install option.';
    } else if (pending) {
      title = 'Continue in your browser’s install prompt.';
      detail = 'Your browser controls installation. You can accept or cancel its confirmation.';
    } else if (ready) {
      title = 'Your browser is ready to install Arrow Cube.';
      detail = 'Choose Install app to open the browser’s confirmation. Installation only happens with your approval.';
    } else if (accepted) {
      title = 'The browser accepted your install request.';
      detail = 'Finish any remaining browser confirmation. Installation has not yet been confirmed by this page.';
    } else {
      title = 'Your browser has not offered an install prompt.';
      detail = 'Open this page directly in a full browser, rather than an app preview. Check the browser menu for its install or add-to-home-screen option. Availability depends on the browser, and an already-installed app may not show another prompt.';
    }
    if (status) status.textContent = message || title;
    if (guidance) guidance.textContent = detail;
    if (offlineStatus) offlineStatus.textContent = offline;
  }
  function announce(text) { message = text; update(); notify(text); }
  update();
  function openHelp() {
    update();
    if (helpDialog && !helpDialog.open) helpDialog.showModal();
  }
  for (const control of [helpButton, mainHelp].filter(Boolean)) control.addEventListener('click', openHelp, options);
  appDisplay?.addEventListener?.('change', event => {
    if (event.matches) { installed = true; deferredPrompt = null; update(); }
  }, options);
  window.addEventListener('pageshow', () => {
    if (appDisplay?.matches || navigator.standalone === true) { installed = true; deferredPrompt = null; }
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
            : 'Installation canceled. You can use Install help or try again when the browser offers it.');
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
