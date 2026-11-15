import test from 'node:test';
import assert from 'node:assert/strict';
import { setupViewport } from '../src/viewport.js';

function harness({ visual = true } = {}) {
  const frames = new Map(), timers = new Map(), styles = new Map();
  const window = new EventTarget(), document = new EventTarget(), viewport = new EventTarget();
  const worker = new EventTarget(), display = new EventTarget();
  let next = 0;
  Object.assign(viewport, { width: 393, height: 799, offsetLeft: 0, offsetTop: 0, scale: 1 });
  Object.assign(window, { innerWidth: 393, innerHeight: 851, visualViewport: visual ? viewport : undefined,
    navigator: { serviceWorker: worker }, matchMedia: () => display,
    requestAnimationFrame(callback) { const id = ++next; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(callback) { const id = ++next; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  Object.assign(document, { visibilityState: 'visible', documentElement: {
    clientWidth: 393, clientHeight: 851, style: { setProperty: (key, value) => styles.set(key, value) },
  } });
  const cleanup = setupViewport({ window, document });
  const flush = () => { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(); };
  return { window, document, viewport, worker, display, cleanup, frames, timers, flush,
    value: key => Number.parseFloat(styles.get(`--game-viewport-${key}`)),
    event(target, type) { target.dispatchEvent(new Event(type)); flush(); },
    settle() { const pending = [...timers.values()]; timers.clear(); for (const callback of pending) callback(); flush(); },
  };
}

test('initial layout uses the visible height even when the PWA layout viewport is taller', () => {
  const h = harness();
  assert.equal(h.value('height'), 799);
  assert.equal(h.value('bottom'), 52);
  assert.equal(h.value('width'), 393);
  h.cleanup();
});

test('visual viewport resize and scroll keep controls above obscured space', () => {
  const h = harness();
  h.viewport.height = 510; h.event(h.viewport, 'resize');
  assert.equal(h.value('height'), 510); assert.equal(h.value('bottom'), 341);
  h.viewport.offsetTop = 40; h.event(h.viewport, 'scroll');
  assert.equal(h.value('top'), 40); assert.equal(h.value('bottom'), 301);
  h.cleanup();
});

test('warm resume, display-mode changes, and worker activation remeasure without reloading', () => {
  const h = harness();
  h.event(h.window, 'pageshow');
  h.viewport.height = 760; h.settle();
  assert.equal(h.value('height'), 760, 'remeasure after Android finishes its resume animation');
  h.document.visibilityState = 'hidden';
  h.viewport.height = 700; h.event(h.viewport, 'resize');
  assert.equal(h.value('height'), 760);
  h.document.visibilityState = 'visible'; h.event(h.document, 'visibilitychange');
  assert.equal(h.value('height'), 700);
  h.viewport.height = 720; h.event(h.worker, 'controllerchange');
  assert.equal(h.value('height'), 720);
  h.viewport.height = 730; h.event(h.display, 'change');
  assert.equal(h.value('height'), 730);
  h.viewport.height = 740; h.event(h.window, 'focus');
  assert.equal(h.value('height'), 740);
  h.cleanup();
});

test('older browsers fall back to window sizing and ignore transient zero dimensions', () => {
  const h = harness({ visual: false });
  assert.equal(h.value('height'), 851);
  h.window.innerHeight = 600; h.event(h.window, 'resize');
  assert.equal(h.value('height'), 600);
  h.window.innerHeight = 0; h.document.documentElement.clientHeight = 0;
  h.event(h.window, 'resize'); assert.equal(h.value('height'), 600);
  h.cleanup();
});

test('browser zoom preserves magnification instead of shrinking the game layout', () => {
  const h = harness();
  Object.assign(h.viewport, { scale: 2, width: 196.5, height: 399.5, offsetTop: 100 });
  h.event(h.viewport, 'resize');
  assert.equal(h.value('width'), 393); assert.equal(h.value('height'), 851);
  assert.equal(h.value('top'), 0);
  h.cleanup();
});

test('cleanup cancels deferred measurements and removes lifecycle listeners', () => {
  const h = harness(); h.cleanup();
  assert.equal(h.frames.size, 0); assert.equal(h.timers.size, 0);
  h.viewport.height = 500; h.event(h.window, 'pageshow'); h.event(h.viewport, 'resize'); h.settle();
  assert.equal(h.value('height'), 799);
});
