export function setupInstall(button, { production = import.meta.env?.PROD === true } = {}) {
  const get = id => document.getElementById(id);
  const dialog = get('install-dialog');
  const confirm = get('install-confirm');
  const dismiss = get('install-dismiss');
  const manual = get('install-manual');
  const status = get('install-status');
  const copyDetails = get('install-copy');
  const link = get('install-link');
  const copyStatus = get('install-copy-status');
  const publicURL = get('public-game-url').href;
  const secure = window.isSecureContext === true;
  const embedded = window.self !== window.top;
  const modernInstall = secure && !embedded && typeof navigator.install === 'function';
  const agent = navigator.userAgent || '';
  const ios = /iPhone|iPad|iPod/.test(agent) || navigator.standalone === true
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = navigator.userAgentData?.platform === 'Android' || /Android/i.test(agent);
  const macSafari = /Macintosh/.test(agent) && /Version\/.*Safari\//.test(agent);
  const platform = ios ? 'ios' : android ? 'android' : !secure ? 'insecure' : macSafari ? 'safari' : 'desktop';
  const display = window.matchMedia?.('(display-mode: standalone)');
  const controller = new AbortController();
  const options = { signal: controller.signal };
  let visit = 0;
  let timer;
  let ready = false;
  let offered = false;
  let pending = false;
  let deferredPrompt = null;
  let external = isExternalLaunch();
  let installed = inOwnAppWindow();

  link.value = publicURL;
  for (const anchor of document.querySelectorAll('[data-install-url]')) anchor.href = publicURL;
  for (const steps of document.querySelectorAll('[data-install-steps]')) {
    steps.hidden = steps.dataset.installSteps !== platform;
  }
  for (const name of document.querySelectorAll('[data-install-name]')) {
    name.hidden = name.dataset.installName !== (secure ? 'secure' : 'insecure');
  }

  function isExternalLaunch() {
    const fromDashboard = new URLSearchParams(window.location.hash.slice(1)).getAll('from').includes('games-dashboard')
      || /^https:\/\/(?:games\.chrisawad\.com(?:\/|$)|chrisawad\.github\.io\/games-dashboard(?:[/?#]|$))/i.test(document.referrer);
    const androidApp = android && /^android-app:\/\/(?!org\.chromium\.webapk\.)/i.test(document.referrer);
    const namedApp = /FBAN|FBAV|FB_IAB|Instagram|MicroMessenger|\bLine\/|LinkedInApp|GSA\/|Snapchat|TikTok|BytedanceWebview|Pinterest|Twitter for/i.test(agent);
    const inAppBrowser = ((ios || android) && namedApp)
      || (android && /;\s*wv\b|Version\/4\.0.*Chrome\//i.test(agent))
      || (ios && /AppleWebKit/i.test(agent) && !/Safari\//i.test(agent) && !display?.matches && navigator.standalone !== true);
    return embedded || fromDashboard || androidApp || inAppBrowser;
  }

  function inOwnAppWindow() {
    return !external && (display?.matches === true || navigator.standalone === true);
  }

  function update() {
    const native = !installed && (pending || modernInstall || deferredPrompt !== null);
    button.hidden = installed;
    manual.hidden = native && !external;
    confirm.hidden = !native;
    confirm.setAttribute('aria-disabled', String(pending));
    confirm.textContent = pending ? 'Installing…' : 'Install app';
  }

  function confirmInstalled() {
    installed = true;
    deferredPrompt = null;
    status.textContent = '';
    update();
    if (dialog.open) dialog.close();
  }

  function show() {
    if (installed || dialog.open) return;
    copyStatus.textContent = '';
    status.textContent = '';
    copyDetails.open = external;
    for (const step of document.querySelectorAll('[data-install-context]')) {
      step.hidden = step.dataset.installContext !== (external ? 'embedded' : 'browser');
    }
    update();
    const focusInstall = !confirm.hidden && !external;
    confirm.toggleAttribute('autofocus', focusInstall);
    dismiss.toggleAttribute('autofocus', !focusInstall);
    dialog.showModal();
    offered = true;
  }

  function offerInstall() {
    if (!ready || offered || installed || document.visibilityState === 'hidden') return;
    if (document.querySelector('dialog[open], dialog:is(:popover-open)')) {
      // Another game dialog already owns this visit's entry interaction.
      offered = true;
      return;
    }
    show();
  }

  async function checkInstalled(current) {
    if (installed || !secure || embedded || typeof navigator.getInstalledRelatedApps !== 'function') return;
    const manifestURL = document.querySelector('link[rel~="manifest"]')?.href;
    if (!manifestURL) return;
    const manifestID = new URL('./', manifestURL).href;
    try {
      const related = await navigator.getInstalledRelatedApps();
      if (controller.signal.aborted || current !== visit || installed) return;
      if (related.some(app => app.platform === 'webapp' && (app.url
        ? app.url === manifestURL
        : app.id === manifestID))) {
        confirmInstalled();
      }
    } catch {
      // A missing or denied result leaves installation unconfirmed.
    }
  }

  function beginVisit() {
    const current = ++visit;
    offered = false;
    ready = false;
    external = isExternalLaunch();
    if (inOwnAppWindow()) confirmInstalled();
    update();
    clearTimeout(timer);
    function offerWhenReady() {
      if (controller.signal.aborted || current !== visit || ready) return;
      clearTimeout(timer);
      ready = true;
      offerInstall();
    }
    // Give the browser a moment to confirm this app without waiting on a hung lookup.
    timer = setTimeout(offerWhenReady, 300);
    checkInstalled(current).then(offerWhenReady);
  }

  button.addEventListener('click', () => {
    if (installed) return;
    const settings = button.closest('dialog');
    if (settings?.open) settings.close();
    show();
  }, options);
  link.addEventListener('focus', () => link.select(), options);
  get('install-copy-button').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(publicURL);
      copyStatus.textContent = 'Link copied.';
    } catch {
      if (!dialog.open) return;
      link.focus();
      link.select();
      copyStatus.textContent = 'Use your device’s Copy command to copy the selected link.';
    }
  }, options);

  update();
  if (document.readyState === 'complete') beginVisit();
  else window.addEventListener('load', beginVisit, { ...options, once: true });
  document.addEventListener('visibilitychange', offerInstall, options);
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    if (dialog.open) dialog.close();
    beginVisit();
  }, options);
  display?.addEventListener?.('change', () => {
    if (inOwnAppWindow()) confirmInstalled();
  }, options);
  window.addEventListener('beforeinstallprompt', event => {
    if (!secure || embedded || installed) return;
    event.preventDefault();
    deferredPrompt = event;
    status.textContent = '';
    update();
  }, options);
  window.addEventListener('appinstalled', confirmInstalled, options);

  confirm.addEventListener('click', async () => {
    if (pending || installed || (!modernInstall && !deferredPrompt)) return;
    pending = true;
    status.textContent = '';
    update();
    try {
      // Call the browser installer directly in the click handler to retain user activation.
      if (modernInstall) {
        await navigator.install();
        if (!controller.signal.aborted) confirmInstalled();
      } else {
        const prompt = deferredPrompt;
        deferredPrompt = null;
        await prompt.prompt();
        const choice = await prompt.userChoice;
        if (!controller.signal.aborted && !installed && choice.outcome !== 'accepted') {
          status.textContent = 'Installation canceled. You can keep playing here.';
        }
      }
    } catch (error) {
      if (!controller.signal.aborted && !installed) {
        status.textContent = error?.name === 'AbortError'
          ? 'Installation canceled. You can keep playing here.'
          : 'The installer could not open. Try again or use your browser’s install menu.';
      }
    } finally {
      pending = false;
      if (!controller.signal.aborted) update();
    }
  }, options);

  // Keep the default worker lifecycle so updates cannot interrupt an active puzzle.
  if (production && secure && 'serviceWorker' in navigator) {
    const register = () => navigator.serviceWorker.register('./sw.js').catch(error => {
      if (!controller.signal.aborted) console.warn('Offline mode could not be enabled.', error);
    });
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { ...options, once: true });
  }
  return () => {
    controller.abort();
    clearTimeout(timer);
  };
}
