import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import test from 'node:test';
import { setupInstall } from '../src/install.js';

const publicURL = 'https://cube.chrisawad.com/';
const manifestURL = 'https://chrisawad.github.io/arrow-cube/manifest.webmanifest';

class Element extends EventTarget {
  open = false;
  hidden = false;
  textContent = '';
  attributes = new Map();
  shows = 0;

  setAttribute(name, value) { this.attributes.set(name, value); }
  toggleAttribute(name, condition) {
    if (condition) this.attributes.set(name, '');
    else this.attributes.delete(name);
  }
  closest() { return this.parent; }
  showModal() { this.open = true; this.shows += 1; }
  close() { this.open = false; }
  click() { this.dispatchEvent(new Event('click')); }
  focus() { this.dispatchEvent(new Event('focus')); }
  select() { this.selected = true; }
}

function fixture(t, { hash = '', agent = '', referrer = '', immediate = true, secure = true, standalone = false,
  embedded = false, browser = {}, production = false } = {}) {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, new Element());
    return nodes.get(id);
  };
  const display = Object.assign(new EventTarget(), { matches: standalone });
  const window = Object.assign(new EventTarget(), {
    isSecureContext: secure, location: { hash }, matchMedia: () => display,
  });
  window.self = window;
  window.top = embedded ? {} : window;
  const document = Object.assign(new EventTarget(), {
    readyState: immediate ? 'complete' : 'loading', visibilityState: 'visible', referrer,
    getElementById: get, querySelectorAll: () => [],
    querySelector: selector => selector.startsWith('link') ? { href: manifestURL }
      : ['install-dialog', 'settings-dialog'].map(get).find(dialog => dialog.open),
  });
  for (const [name, value] of Object.entries({ document, window, navigator: { userAgent: agent, ...browser } })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name]);
  }
  get('public-game-url').href = publicURL;
  const entry = get('install');
  const dialog = get('install-dialog');
  const confirm = get('install-confirm');
  entry.parent = get('settings-dialog');
  const cleanup = setupInstall(entry, { production });
  t.after(cleanup);
  return { get, window, document, entry, dialog, confirm, display, cleanup };
}

function pageshow(persisted) {
  return Object.assign(new Event('pageshow'), { persisted });
}

function addNativePrompt(window, userChoice = 'dismissed') {
  let calls = 0;
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt() { calls += 1; },
    userChoice: Promise.resolve({ outcome: userChoice }),
  });
  window.dispatchEvent(event);
  return { event, called: () => calls };
}

test('offers once per visit, allows reopening from Settings and offers again on history restore', async t => {
  const { window, document, entry, dialog } = fixture(t);
  await wait(0);
  assert.equal(dialog.shows, 1);
  dialog.close();
  window.dispatchEvent(new Event('focus'));
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(pageshow(false));
  assert.equal(dialog.shows, 1);

  entry.parent.showModal();
  entry.click();
  assert.equal(entry.parent.open, false);
  assert.equal(dialog.open, true);
  assert.equal(dialog.shows, 2);
  dialog.close();
  window.dispatchEvent(pageshow(true));
  await wait(0);
  assert.equal(dialog.shows, 3);
});

test('waits for the visible visit and leaves any existing game dialog alone', async t => {
  const { document, window, dialog, entry } = fixture(t, { immediate: false });
  document.visibilityState = 'hidden';
  window.dispatchEvent(new Event('load'));
  await wait(0);
  assert.equal(dialog.open, false);
  document.visibilityState = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(dialog.open, true);
  dialog.close();
  entry.parent.showModal();
  window.dispatchEvent(pageshow(true));
  await wait(0);
  entry.parent.close();
  document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(dialog.shows, 1);
});

test('offers on a Dashboard launch with inherited standalone mode and an unresolved install lookup', async t => {
  const { dialog, entry, get } = fixture(t, {
    hash: '#puzzle=original&from=games-dashboard', standalone: true,
    browser: { getInstalledRelatedApps: () => new Promise(() => {}) },
  });
  await wait(330);
  assert.equal(dialog.open, true);
  assert.equal(entry.hidden, false);
  assert.equal(get('install-copy').open, true);
  assert.equal(get('install-link').value, publicURL);
});

test('matches only Arrow Cube install evidence and ignores an old lookup after Back', async t => {
  const lookups = [];
  const { dialog, entry, window } = fixture(t, {
    browser: { getInstalledRelatedApps: () => new Promise(resolve => lookups.push(resolve)) },
  });
  window.dispatchEvent(pageshow(true));
  lookups[0]([{ platform: 'webapp', url: manifestURL }]);
  lookups[1]([{ platform: 'webapp', url: 'https://chrisawad.github.io/Games-Dashboard/manifest.webmanifest' }]);
  await wait(0);
  assert.equal(dialog.shows, 1);
  assert.equal(entry.hidden, false);
  window.dispatchEvent(pageshow(true));
  lookups[2]([{ platform: 'webapp', url: manifestURL }]);
  await wait(0);
  assert.equal(dialog.open, false);
  assert.equal(dialog.shows, 1);
  assert.equal(entry.hidden, true);
});

test('suppresses the dialog and entry in the installed app window', async t => {
  const { dialog, entry, window } = fixture(t, { standalone: true });
  await wait(0);
  window.dispatchEvent(pageshow(true));
  await wait(0);
  assert.equal(dialog.shows, 0);
  assert.equal(entry.hidden, true);
});

test('uses the native offer only on click and consumes dismissed prompts once', async t => {
  const { confirm, dialog, entry, get, window } = fixture(t);
  const { event, called } = addNativePrompt(window);
  await wait(0);
  assert.equal(event.defaultPrevented, true);
  assert.equal(confirm.hidden, false);
  assert.equal(get('install-manual').hidden, true);
  assert.equal(called(), 0);
  confirm.click();
  confirm.click();
  await wait(0);
  assert.equal(called(), 1);
  assert.equal(confirm.hidden, true);
  assert.equal(get('install-manual').hidden, false);
  assert.equal(get('install-status').textContent, 'Installation canceled. You can keep playing here.');

  addNativePrompt(window, 'accepted');
  confirm.click();
  await wait(0);
  assert.equal(entry.hidden, false);
  window.dispatchEvent(new Event('appinstalled'));
  assert.equal(dialog.open, false);
  assert.equal(entry.hidden, true);
});

test('keeps embedded instructions visible alongside a native offer and copies the clean URL', async t => {
  const copied = [];
  const { confirm, get } = fixture(t, {
    agent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro; wv) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
    browser: { install: async () => {}, clipboard: { writeText: async value => copied.push(value) } },
  });
  await wait(0);
  assert.equal(confirm.hidden, false);
  assert.equal(get('install-manual').hidden, false);
  assert.equal(get('install-copy').open, true);
  get('install-copy-button').click();
  await wait(0);
  assert.deepEqual(copied, [publicURL]);
  assert.equal(get('install-copy-status').textContent, 'Link copied.');
});

test('selects the clean URL for manual copying when clipboard access fails', async t => {
  const { get } = fixture(t, { secure: false });
  await wait(0);
  get('install-copy-button').click();
  assert.equal(get('install-link').selected, true);
  assert.equal(get('install-copy-status').textContent, 'Use your device’s Copy command to copy the selected link.');
});

test('registers the existing worker once in secure production without waiting for installation', async t => {
  const registrations = [];
  const { dialog, window } = fixture(t, {
    immediate: false, production: true,
    browser: { serviceWorker: { register: async path => registrations.push(path) } },
  });
  assert.deepEqual(registrations, []);
  window.dispatchEvent(new Event('load'));
  await wait(0);
  assert.equal(dialog.open, true);
  window.dispatchEvent(pageshow(true));
  await wait(0);
  assert.deepEqual(registrations, ['./sw.js']);
});
