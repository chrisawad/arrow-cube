/** Installation is an enhancement; keep its button hidden until the browser can prompt. */
export function setupInstall(button, notify = () => {}) {
  let deferredPrompt = null;
  let installed = globalThis.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  const modernInstall = typeof navigator.install === 'function';
  const controller = new AbortController();
  const options = { signal: controller.signal };
  function updateButton() { button.hidden = installed || (!modernInstall && !deferredPrompt); }
  updateButton();
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); deferredPrompt = event; updateButton();
  }, options);
  window.addEventListener('appinstalled', () => {
    installed = true; deferredPrompt = null; updateButton(); notify('Arrow Cube is installed.');
  }, options);
  button.addEventListener('click', async () => {
    if (button.getAttribute('aria-disabled') === 'true') return;
    button.setAttribute('aria-disabled', 'true');
    try {
      if (modernInstall) {
        await navigator.install();
        installed = true; notify('Arrow Cube was installed or opened.');
      } else if (deferredPrompt) {
        const prompt = deferredPrompt; deferredPrompt = null;
        await prompt.prompt();
        const choice = await prompt.userChoice;
        if (choice.outcome === 'accepted') { installed = true; notify('Arrow Cube is installed.'); }
      }
    } catch (error) {
      if (error.name !== 'AbortError') { console.warn('Installation could not start.', error); notify('Your browser could not install the game. You can keep playing here.'); }
    } finally { button.removeAttribute('aria-disabled'); updateButton(); }
  }, options);

  // Default worker lifecycle avoids replacing code in an active game. A new version
  // takes over once the old app is closed; game progress is saved independently.
  if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
    const register = () => navigator.serviceWorker.register('./sw.js').catch(error => {
      console.warn('Offline mode could not be enabled.', error);
      notify('Offline setup is unavailable. Progress still saves on this device.');
    });
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true, signal: controller.signal });
  }
  return () => controller.abort();
}
