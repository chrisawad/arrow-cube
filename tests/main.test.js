import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { generatePuzzle, canRemove, getRemovable, GENERATOR_VERSION } from '../src/engine.js';

// Exercise the actual entry point and DOM event handlers with the real puzzle
// engine. Only browser rendering/audio/storage boundaries are replaced here;
// CanvasTexture allocation and animation rendering have their own regressions.
const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  .replace(/^import\s+.*;\r?$/gm, '');

class Element {
  listeners = new Map();
  attributes = new Map();
  style = {};
  dataset = {};
  textContent = '';
  value = '';
  open = false;
  removed = false;
  firstChild = { textContent: '' };
  lastChild = { textContent: '' };
  classes = new Set();
  classList = {
    add: value => this.classes.add(value),
    remove: value => this.classes.delete(value),
    toggle: (value, force) => force ? this.classes.add(value) : this.classes.delete(value),
  };
  get valueAsNumber() { return this.value === '' ? NaN : Number(this.value); }
  get validity() { const n = this.valueAsNumber; return { valid: Number.isInteger(n) && n >= 2 && n <= 64 }; }
  addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) || []), fn]); }
  emit(type, properties = {}) {
    const event = { target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...properties };
    for (const fn of this.listeners.get(type) || []) fn(event);
    return event;
  }
  click() { return this.emit('click'); }
  setAttribute(key, value) { this.attributes.set(key, value); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() { this.focused = true; }
  select() { this.selected = true; }
  remove() { this.removed = true; }
}

function boot(saved = null, { search = '' } = {}) {
  const ids = [...source.matchAll(/\$\('([^']+)'\)/g)].map(match => match[1]);
  const elements = new Map(ids.map(id => [id, new Element()]));
  const presets = [3, 5, 8, 12].map(size => Object.assign(new Element(), { dataset: { size: String(size) } }));
  const document = {
    getElementById: id => elements.get(id)?.removed ? null : elements.get(id),
    querySelectorAll: selector => selector === '[data-size]' ? presets
      : selector === 'dialog' ? [...elements.entries()].filter(([id]) => id.endsWith('-dialog')).map(([, element]) => element) : [],
  };
  const window = new Element();
  const initialURL = new URL(`http://riva-laptop:5173/${search}`);
  window.location = { href: initialURL.href, search: initialURL.search, reload() { assert.fail('new boards must not reload the page'); } };
  window.history = { state: null, replaceState(_state, _title, url) {
    const cleanURL = new URL(url);
    window.location.href = cleanURL.href;
    window.location.search = cleanURL.search;
  } };
  const saves = [], sounds = { prepared: 0, swoosh: 0, blocked: 0, win: 0 }, views = [];
  class View {
    calls = [];
    animations = [];
    constructor(_stage, options) { this.options = options; this.setMotionMode(options.motion); views.push(this); }
    setMotionMode(mode) { this.motionMode = mode; }
    setPuzzle(puzzle, removed, blocked) {
      for (const animation of this.animations) animation.resolve(false);
      this.animations = [];
      this.puzzle = puzzle; this.removed = new Set(removed); this.blocked = new Set(blocked);
      this.calls.push({ puzzle, removed: new Set(removed), blocked: new Set(blocked) });
    }
    resetView() {}
    clearHighlight() { this.highlighted = null; }
    highlight(id) { this.highlighted = id; }
    focusFace() {}
    rotateBy() {}
    animate(id, type, onImpact = () => {}) {
      return new Promise(resolve => this.animations.push({ id, type, resolve, onImpact }));
    }
    bumpArrow(id, { onImpact }) { return this.animate(id, 'bump', onImpact); }
    removeArrow(id) { return this.animate(id, 'remove'); }
  }
  class Audio {
    setEnabled() {}
    prepare() { sounds.prepared++; }
    swoosh() { sounds.swoosh++; }
    blocked() { sounds.blocked++; }
    win() { sounds.win++; }
  }
  let nextSeed = 8137;
  vm.runInNewContext(source, {
    document, window, URL, URLSearchParams, generatePuzzle, canRemove, getRemovable, GENERATOR_VERSION,
    CubeView: View, GameAudio: Audio, loadProgress: () => saved,
    saveProgress: progress => { saves.push(structuredClone(progress)); return true; },
    setupInstall: () => {}, matchMedia: () => ({ matches: false }),
    crypto: { getRandomValues: array => { array[0] = nextSeed++; return array; } },
    setTimeout: () => 1, clearTimeout: () => {}, console,
  }, { filename: 'main.js' });
  assert.equal(views.length, 1);
  const view = views[0];
  assert.equal(view.calls.length, 1, 'startup must initialize the board');
  return {
    view, saves, sounds, views, presets, get: id => elements.get(id), search: () => window.location.search,
    state: () => JSON.parse(JSON.stringify(window.__arrowCube.getState())),
    submit(size) {
      elements.get('choose-size').click();
      elements.get('size-input').value = String(size);
      elements.get('size-input').emit('input');
      return elements.get('difficulty-form').emit('submit');
    },
  };
}
const saveFor = (size = 3, seed = 17, extra = {}) => ({ size, seed, generatorVersion: GENERATOR_VERSION,
  removed: [], blocked: [], moves: 0, sound: true, bestSize: size, ...extra });
const blockedId = h => h.view.puzzle.arrows.find(arrow => !canRemove(h.view.puzzle, arrow.id, new Set())).id;

test('custom and preset board changes render immediately through 6 → 8 → 12 → 3 and odd custom sizes', () => {
  const h = boot();
  for (const size of [6, 8, 12, 3, 7, 11]) {
    h.get('choose-size').click();
    const preset = h.presets.find(button => Number(button.dataset.size) === size);
    if (preset) preset.click();
    else { h.get('size-input').value = String(size); h.get('size-input').emit('input'); }
    const oldCalls = h.view.calls.length;
    const event = h.get('difficulty-form').emit('submit');
    assert.equal(event.defaultPrevented, true);
    assert.equal(h.view.calls.length, oldCalls + 1, 'setPuzzle runs synchronously on submit');
    assert.equal(h.view.puzzle.size, size);
    assert.equal(h.state().size, size);
    assert.equal(h.state().gridSize, h.view.puzzle.gridSize);
    assert.equal(h.state().generatorVersion, GENERATOR_VERSION);
    assert.equal(h.saves.at(-1).size, size);
    assert.equal(h.get('dimension').textContent, `${size} × ${size}`);
    assert.equal(h.get('difficulty-dialog').open, false);
  }
  assert.equal(h.views.length, 1, 'changing levels must reuse the live view, not reload');
});

test('submit reads the latest input value even when the selected preset or label is stale', () => {
  const h = boot();
  h.get('choose-size').click();
  h.presets.find(button => button.dataset.size === '8').click();
  h.get('size-input').value = '9';
  h.get('difficulty-form').emit('submit');
  assert.equal(h.state().size, 9);
  assert.equal(h.view.puzzle.size, 9);
});

test('invalid custom dimensions leave the board intact and input clears validation errors', () => {
  const h = boot();
  const initial = h.state(), calls = h.view.calls.length;
  for (const invalid of ['', '1', '65', '3.5', 'not-a-number']) {
    h.get('size-input').value = invalid;
    h.get('difficulty-form').emit('submit');
    assert.equal(h.view.calls.length, calls);
    assert.equal(h.state().seed, initial.seed);
    assert.equal(h.get('size-input').getAttribute('aria-invalid'), 'true');
    assert.equal(h.get('size-input').focused, true);
  }
  h.get('size-input').value = '5'; h.get('size-input').emit('input');
  assert.equal(h.get('size-input').getAttribute('aria-invalid'), 'false');
  assert.equal(h.get('size-error').textContent, '');
  assert.equal(h.view.calls.length, calls, 'typing alone must not replace the board');
});

test('restored crash colors filter stale or removed IDs and restart clears them on the same puzzle', () => {
  const h = boot(saveFor(3, 17, { removed: [0], blocked: [0, 1, 999999], moves: 1 }));
  assert.deepEqual(h.state().blocked, [1]);
  assert.deepEqual([...h.view.blocked], [1]);
  assert.deepEqual(h.saves.at(-1).blocked, [1]);
  const initial = h.state();
  h.get('restart').click();
  assert.equal(h.state().seed, initial.seed);
  assert.equal(h.state().generatorVersion, initial.generatorVersion);
  assert.deepEqual(h.state().removed, []);
  assert.deepEqual(h.state().blocked, []);
  assert.equal(h.view.blocked.size, 0);
  assert.equal(h.state().moves, 0);
});

test('a crash persists red state and ticks once at impact without counting a move', async () => {
  const h = boot(), id = blockedId(h), before = h.state();
  const playing = h.view.options.onSelect(id), impact = h.view.animations.at(-1);
  assert.equal(impact.type, 'bump');
  assert.equal(h.sounds.prepared, 1, 'unlock delayed impact audio during the click');
  assert.equal(h.sounds.swoosh, 0, 'collisions never play a swoosh');
  assert.equal(h.sounds.blocked, 0, 'no tick before physical impact');
  assert.deepEqual(h.state().blocked, []);
  impact.onImpact(); impact.onImpact();
  assert.equal(h.sounds.blocked, 1);
  assert.equal(h.sounds.swoosh, 0);
  assert.deepEqual(h.state().blocked, [id]);
  assert.deepEqual(h.saves.at(-1).blocked, [id]);
  assert.equal(h.state().moves, before.moves);
  assert.deepEqual(h.state().removed, before.removed);
  impact.resolve(false); await playing;
  h.get('hint').click();
  assert.deepEqual(h.state().blocked, [id], 'hints must not erase saved crash colors');
  const restored = boot(h.saves.at(-1));
  assert.deepEqual([...restored.view.blocked], [id]);
});

test('changing size before impact ignores stale crash callbacks and keeps the new animation busy', async () => {
  const h = boot(), oldId = blockedId(h);
  const oldPlay = h.view.options.onSelect(oldId), oldAnimation = h.view.animations.at(-1);
  h.submit(7);
  const freshId = h.state().available[0];
  const newPlay = h.view.options.onSelect(freshId), newAnimation = h.view.animations.at(-1);
  oldAnimation.onImpact();
  await oldPlay;
  assert.equal(h.state().size, 7);
  assert.equal(h.state().busy, true, 'old completion must not release the new animation guard');
  assert.equal(h.sounds.blocked, 0);
  assert.deepEqual(h.state().blocked, []);
  assert.deepEqual(h.saves.at(-1).blocked, []);
  newAnimation.resolve(true); await newPlay;
  assert.equal(h.state().busy, false);
});

test('changing size during removal immediately replaces the board without an old win or state update', async () => {
  const h = boot(), id = h.state().available[0];
  const oldPlay = h.view.options.onSelect(id);
  assert.equal(h.state().moves, 1);
  h.submit(12);
  await oldPlay;
  assert.equal(h.state().size, 12);
  assert.equal(h.state().moves, 0);
  assert.deepEqual(h.state().removed, []);
  assert.deepEqual(h.state().blocked, []);
  assert.equal(h.sounds.win, 0);
  assert.equal(h.get('win-dialog').open, false);
});

test('releasing a previously red arrow removes its saved color with the arrow', async () => {
  const puzzle = generatePuzzle(3, 17, GENERATOR_VERSION), id = getRemovable(puzzle)[0].id;
  const h = boot(saveFor(3, 17, { blocked: [id] }));
  const playing = h.view.options.onSelect(id), animation = h.view.animations.at(-1);
  assert.equal(animation.type, 'remove');
  assert.equal(h.sounds.swoosh, 1, 'successful releases still swoosh');
  assert.equal(h.sounds.blocked, 0);
  assert.deepEqual(h.state().removed, [id]);
  assert.deepEqual(h.state().blocked, []);
  assert.deepEqual(h.saves.at(-1).blocked, []);
  assert.equal(h.state().moves, 1);
  animation.resolve(true); await playing;
});

test('legacy progress without crash state starts normally', () => {
  const saved = saveFor(); delete saved.blocked;
  const h = boot(saved);
  assert.deepEqual(h.state().blocked, []);
  assert.equal(h.view.blocked.size, 0);
});

test('full-motion link restores movement preference without replacing the saved board', () => {
  const saved = saveFor(7, 419, { removed: [0, 1], moves: 2, motion: 'reduced' });
  const h = boot(saved, { search: '?keep=1&motion=full#board' });
  assert.equal(h.view.options.motion, 'full');
  assert.equal(h.get('motion-select').value, 'full');
  assert.equal(h.saves.at(-1).motion, 'full');
  assert.equal(h.search(), '?keep=1', 'consume the override so later choices survive reloading the same URL');
  assert.equal(h.state().seed, 419);
  assert.deepEqual(h.state().removed, [0, 1]);
  h.get('motion-select').value = 'reduced';
  h.get('motion-select').emit('change');
  assert.equal(h.view.motionMode, 'reduced');
  assert.equal(h.view.calls.length, 1, 'changing motion must not reset the puzzle');
  const restored = boot(h.saves.at(-1), { search: h.search() });
  assert.equal(restored.view.options.motion, 'reduced');
  assert.deepEqual(restored.state().removed, [0, 1]);
});

test('unknown motion links preserve the saved choice and old saves follow the device', () => {
  assert.equal(boot(saveFor(3, 17, { motion: 'full' }), { search: '?motion=invalid' }).view.options.motion, 'full');
  assert.equal(boot(saveFor()).view.options.motion, 'auto');
});
