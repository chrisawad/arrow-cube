import test from 'node:test';
import assert from 'node:assert/strict';
import { setupInstall } from '../src/install.js';

class Element extends EventTarget {
  hidden = false;
  textContent = '';
  open = false;
  attributes = new Map();
  setAttribute(key, value) { this.attributes.set(key, value); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  removeAttribute(key) { this.attributes.delete(key); }
  showModal() { this.open = true; }
  click() { this.dispatchEvent(new Event('click')); }
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness(t, { secure = true, embedded = false, installed = false, modern,
  production = false, serviceWorker, readyState = 'complete' } = {}) {
  const elements = new Map(['install', 'install-help', 'install-dialog', 'install-confirm',
    'install-status', 'install-guidance', 'install-offline'].map(id => [id, new Element()]));
  const win = new EventTarget();
  win.isSecureContext = secure; win.self = win; win.top = embedded ? {} : win;
  const nav = {};
  if (modern) nav.install = modern;
  if (serviceWorker) nav.serviceWorker = serviceWorker;
  const globals = { window: win, navigator: nav, document: { readyState, getElementById: id => elements.get(id) },
    matchMedia: () => ({ matches: installed }) };
  for (const [key, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
    t.after(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]);
  }
  const messages = [];
  const cleanup = setupInstall(elements.get('install'), message => messages.push(message), { production });
  t.after(cleanup);
  return { win, messages, cleanup, get: id => elements.get(id) };
}
function offer(win, { prompt = () => Promise.resolve(), choice = Promise.resolve({ outcome: 'dismissed' }) } = {}) {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  event.prompt = prompt; event.userChoice = choice;
  win.dispatchEvent(event);
  return event;
}

test('insecure LAN pages offer actionable help without exposing a fake install action', t => {
  let calls = 0;
  const h = harness(t, { secure: false, modern: () => { calls++; } });
  assert.equal(h.get('install').hidden, true);
  assert.equal(h.get('install-confirm').hidden, true);
  assert.equal(h.get('install-help').hidden, false);
  assert.match(h.get('install-guidance').textContent, /HTTPS/);
  assert.match(h.get('install-guidance').textContent, /computer serving the game/);
  h.get('install-help').click();
  assert.equal(h.get('install-dialog').open, true);
  assert.equal(offer(h.win).defaultPrevented, false);
  h.get('install').click();
  assert.equal(calls, 0);
});

test('embedded previews direct users to a full browser rather than trying installation', t => {
  const h = harness(t, { embedded: true, modern: () => assert.fail('must not prompt in frame') });
  assert.equal(h.get('install').hidden, true);
  assert.match(h.get('install-guidance').textContent, /full browser/);
  assert.equal(offer(h.win).defaultPrevented, false);
});

test('unsupported browsers retain usable help and never display a nonfunctional install button', t => {
  const h = harness(t);
  assert.equal(h.get('install').hidden, true);
  assert.match(h.get('install-status').textContent, /has not offered/);
  assert.match(h.get('install-guidance').textContent, /browser menu/);
  h.get('install-help').click();
  assert.equal(h.get('install-dialog').open, true);
});

test('fallback prompts run directly on click, are single-use, and only confirm installation on appinstalled', async t => {
  const h = harness(t);
  let clicking = false, calls = 0;
  const event = offer(h.win, { prompt() { assert.equal(clicking, true); calls++; return Promise.resolve(); },
    choice: Promise.resolve({ outcome: 'accepted' }) });
  assert.equal(event.defaultPrevented, true);
  assert.equal(h.get('install').hidden, false);
  clicking = true; h.get('install').click(); clicking = false;
  h.get('install-confirm').click();
  assert.equal(calls, 1);
  assert.equal(h.get('install').getAttribute('aria-disabled'), 'true');
  await flush();
  assert.equal(h.get('install').hidden, true);
  assert.match(h.get('install-status').textContent, /request accepted/i);
  assert(!h.messages.includes('Arrow Cube is installed.'));
  h.get('install').click(); assert.equal(calls, 1);
  h.win.dispatchEvent(new Event('appinstalled'));
  assert.equal(h.messages.at(-1), 'Arrow Cube is installed.');
  assert.equal(h.get('install-help').hidden, true);
});

test('a dismissed fallback prompt reveals help and a fresh event allows another attempt', async t => {
  const h = harness(t);
  let calls = 0;
  offer(h.win, { prompt: () => { calls++; return Promise.resolve(); } });
  h.get('install').click(); await flush();
  assert.equal(h.get('install').hidden, true);
  assert.equal(h.get('install-help').hidden, false);
  assert.match(h.get('install-status').textContent, /canceled/);
  offer(h.win, { prompt: () => { calls++; return Promise.resolve(); } });
  assert.equal(h.get('install').hidden, false);
  h.get('install').click(); await flush();
  assert.equal(calls, 2);
});

test('failed fallback events are discarded and a newly offered event still works', async t => {
  t.mock.method(console, 'warn', () => {});
  const h = harness(t);
  let failures = 0, retries = 0;
  offer(h.win, { prompt() { failures++; throw new Error('platform failure'); } });
  h.get('install').click(); await flush();
  assert.equal(h.get('install').hidden, true);
  assert.equal(h.get('install-help').hidden, false);
  assert.match(h.get('install-status').textContent, /could not start/);
  h.get('install').click(); assert.equal(failures, 1);
  offer(h.win, { prompt: () => { retries++; return Promise.resolve(); } });
  h.get('install').click(); await flush();
  assert.equal(retries, 1);
});

test('a fresh event arriving during a pending attempt is retained for retry', async t => {
  const h = harness(t);
  let settle, secondCalls = 0;
  offer(h.win, { choice: new Promise(resolve => { settle = resolve; }) });
  h.get('install').click();
  offer(h.win, { prompt: () => { secondCalls++; return Promise.resolve(); } });
  h.get('install-confirm').click(); assert.equal(secondCalls, 0);
  settle({ outcome: 'dismissed' }); await flush();
  assert.equal(h.get('install').hidden, false);
  h.get('install-confirm').click(); await flush();
  assert.equal(secondCalls, 1);
});

test('modern API cancellation retains a directly activated retry and success uses accurate wording', async t => {
  let clicking = false, calls = 0;
  const h = harness(t, { modern() {
    assert.equal(clicking, true); calls++;
    return calls === 1 ? Promise.reject(Object.assign(new Error('cancel'), { name: 'AbortError' })) : Promise.resolve();
  } });
  clicking = true; h.get('install').click(); clicking = false; await flush();
  assert.equal(h.get('install').hidden, false);
  assert.equal(h.get('install').getAttribute('aria-disabled'), null);
  assert.match(h.get('install-status').textContent, /canceled/);
  clicking = true; h.get('install').click(); clicking = false; await flush();
  assert.equal(calls, 2);
  assert.equal(h.get('install').hidden, true);
  assert.equal(h.messages.at(-1), 'Arrow Cube was installed or opened.');
});

test('standalone apps suppress installation even if another prompt is offered', t => {
  const h = harness(t, { installed: true });
  assert.equal(h.get('install').hidden, true);
  assert.equal(h.get('install-help').hidden, true);
  assert.equal(offer(h.win).defaultPrevented, false);
});

test('offline setup is production-only and is not required to show a browser-provided install prompt', t => {
  let registrations = 0;
  const h = harness(t, { serviceWorker: { register() { registrations++; } } });
  offer(h.win);
  assert.equal(h.get('install').hidden, false);
  assert.equal(registrations, 0);
  assert.match(h.get('install-offline').textContent, /not enabled for this preview/);
});

test('offline readiness follows activation and never forces a reload or update', async t => {
  const worker = new EventTarget(); worker.state = 'installing';
  const registration = new EventTarget(); registration.installing = worker;
  let calls = 0;
  const h = harness(t, { production: true, serviceWorker: { register(url) {
    calls++; assert.equal(url, './sw.js'); return Promise.resolve(registration);
  } } });
  await flush();
  assert.equal(calls, 1);
  assert.match(h.get('install-offline').textContent, /Preparing/);
  worker.state = 'activated'; registration.active = worker;
  worker.dispatchEvent(new Event('statechange'));
  assert.match(h.get('install-offline').textContent, /ready on this device/);
});

test('offline registration failure does not claim readiness or block installation', async t => {
  t.mock.method(console, 'warn', () => {});
  const h = harness(t, { production: true, serviceWorker: { register: () => Promise.reject(new Error('unavailable')) } });
  await flush();
  assert.match(h.get('install-offline').textContent, /could not finish/);
  offer(h.win); assert.equal(h.get('install').hidden, false);
});

test('cleanup stops pending notifications and removes install listeners', async t => {
  let settle;
  const h = harness(t, { modern: () => new Promise(resolve => { settle = resolve; }) });
  h.get('install').click(); h.cleanup(); settle(); await flush();
  h.win.dispatchEvent(new Event('appinstalled'));
  assert.deepEqual(h.messages, []);
});
