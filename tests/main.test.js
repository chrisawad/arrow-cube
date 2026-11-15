import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { generatePuzzle, canRemove, getRemovable, getArrowMove, GENERATOR_VERSION } from '../src/engine.js';
import { applyRedirectorFlips, flippedRedirectorIds, restoreRedirectors } from '../src/routing.js';
import * as lifeRules from '../src/lives.js';

// Exercise the actual entry point and DOM event handlers with the real puzzle
// engine. Only browser rendering/audio/storage boundaries are replaced here;
// CanvasTexture allocation and animation rendering have their own regressions.
const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  .replace(/^import\s+.*;\r?$/gm, '');

class Element {
  listeners = new Map();
  attributes = new Map();
  style = { setProperty(name, value) { this[name] = value; } };
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
  close() { const wasOpen = this.open; this.open = false; if (wasOpen) this.emit('close'); }
  focus() { this.focused = true; }
  select() { this.selected = true; }
  remove() { this.removed = true; }
}

function boot(saved = null, { search = '', puzzleFactory = generatePuzzle, now = 1800000000000 } = {}) {
  const ids = [...source.matchAll(/\$\('([^']+)'\)/g)].map(match => match[1]);
  const elements = new Map(ids.map(id => [id, new Element()]));
  const hearts = Array.from({length: 5}, () => new Element());
  const resetIcons = Array.from({length: 8}, () => new Element());
  const presets = [3, 5, 8, 12].map(size => Object.assign(new Element(), { dataset: { size: String(size) } }));
  const document = Object.assign(new Element(), {
    visibilityState: 'visible',
    getElementById: id => elements.get(id)?.removed ? null : elements.get(id),
    querySelectorAll: selector => selector === '[data-heart]' ? hearts : selector === '[data-reset]' ? resetIcons : selector === '[data-size]' ? presets
      : selector === 'dialog' ? [...elements.entries()].filter(([id]) => id.endsWith('-dialog')).map(([, element]) => element) : [],
  });
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
    highlight(id, type, reverse = false) { this.highlighted = id; this.highlightReverse = reverse; }
    focusFace() {}
    rotateBy() {}
    animate(id, type, onImpact = () => {}, reverse = false) {
      return new Promise(resolve => this.animations.push({ id, type, resolve, onImpact, reverse }));
    }
    bumpArrow(id, { onImpact, reverse }) { return this.animate(id, 'bump', onImpact, reverse); }
    removeArrow(id, { reverse } = {}) { return this.animate(id, 'remove', undefined, reverse); }
  }
  class Audio {
    setEnabled() {}
    prepare() { sounds.prepared++; }
    swoosh() { sounds.swoosh++; }
    blocked() { sounds.blocked++; }
    win() { sounds.win++; }
  }
  let nextSeed = 8137;
  const intervals = [];
  class Clock extends Date { static now() { return now; } }
  vm.runInNewContext(source, {
    document, window, URL, URLSearchParams, generatePuzzle: puzzleFactory, canRemove, getRemovable, getArrowMove, GENERATOR_VERSION,
    applyRedirectorFlips, flippedRedirectorIds, restoreRedirectors,
    ...lifeRules, Date: Clock,
    CubeView: View, GameAudio: Audio, loadProgress: () => saved,
    saveProgress: progress => { saves.push(structuredClone(progress)); return true; },
    setupInstall: () => {}, matchMedia: () => ({ matches: false }),
    crypto: { getRandomValues: array => { array[0] = nextSeed++; return array; } },
    setTimeout: () => 1, clearTimeout: () => {}, setInterval: callback => intervals.push(callback), console,
  }, { filename: 'main.js' });
  assert.equal(views.length, 1);
  const view = views[0];
  assert.equal(view.calls.length, 1, 'startup must initialize the board');
  return {
    view, saves, sounds, views, presets, hearts, resetIcons, get: id => elements.get(id), search: () => window.location.search,
    state: () => JSON.parse(JSON.stringify(window.__arrowCube.getState())), pagehide: () => window.emit('pagehide'),
    advance(milliseconds) { now += milliseconds; for (const callback of intervals) callback(); },
    visibility(state) { document.visibilityState = state; document.emit('visibilitychange'); },
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
  h.get('loss-restart').click();
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
  assert.equal(h.state().crashes, 0, 'a stale collision cannot use the new board allowance');
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

test('new games start at five with full animation while saved levels and explicit choices are preserved', () => {
  const fresh = boot();
  assert.equal(fresh.state().size, 5);
  assert.equal(fresh.view.options.motion, 'full');
  assert.equal(fresh.get('motion-select').value, 'full');
  assert.equal(fresh.saves.at(-1).bestSize, 5);
  assert.equal(fresh.saves.at(-1).motion, 'full');
  assert.equal(boot(saveFor(3, 17, { motion: 'full' }), { search: '?motion=invalid' }).view.options.motion, 'full');
  assert.equal(boot(saveFor()).view.options.motion, 'full');
  for (const motion of ['auto', 'reduced']) {
    const restored = boot(saveFor(3, 17, { motion }));
    assert.equal(restored.state().size, 3);
    assert.equal(restored.view.options.motion, motion);
  }
});

const twoEndedFixture = (size, seed) => ({ size, seed, gridSize: 4, generatorVersion: 11, wrapEdges: [], redirectors: [],
  arrows: [
    { id: 0, face: 0, direction: { x: 1, y: 0 }, bidirectional: true, cells: [0, 1, 2].map(x => ({ face: 0, x, y: 1 })) },
    { id: 1, face: 0, direction: { x: 0, y: 1 }, cells: [0, 1, 2].map(y => ({ face: 0, x: 3, y })) },
  ] });

test('the clicked half reaches collision or removal and keeps one saved arrow identity', async () => {
  const h = boot(null, { puzzleFactory: twoEndedFixture });
  const blocked = h.view.options.onSelect(0, false), bump = h.view.animations.at(-1);
  assert.equal(bump.type, 'bump'); assert.equal(bump.reverse, false);
  bump.onImpact(); bump.resolve(true); await blocked;
  assert.deepEqual(h.state().blocked, [0]); assert.equal(h.sounds.blocked, 1); assert.equal(h.sounds.swoosh, 0);
  const leaving = h.view.options.onSelect(0, true), removal = h.view.animations.at(-1);
  assert.equal(removal.type, 'remove'); assert.equal(removal.reverse, true);
  removal.resolve(true); await leaving;
  assert.deepEqual(h.saves.at(-1).removed, [0]); assert.deepEqual(h.saves.at(-1).blocked, []);
  assert.equal(h.state().moves, 1); assert.equal(h.sounds.swoosh, 1);
});

test('keyboard hints preserve a reverse-only escape direction', async () => {
  const h = boot(null, { puzzleFactory: twoEndedFixture });
  h.get('hint').click();
  assert.equal(h.view.highlighted, 0); assert.equal(h.view.highlightReverse, true);
  h.get('cube-stage').emit('keydown', { key: 'Enter' });
  const animation = h.view.animations.at(-1);
  assert.equal(animation.type, 'remove'); assert.equal(animation.reverse, true);
  animation.resolve(true); await Promise.resolve();
  assert.deepEqual(h.state().removed, [0]);
});

const purplePuzzle = (size, seed) => ({ size, seed, gridSize: 7, generatorVersion: 13, wrapEdges: [],
  redirectors: [{ id: 9, face: 0, x: 3, y: 3, direction: { x: 0, y: 1 }, flipping: true, flipped: false }],
  arrows: [{ id: 0, face: 0, direction: { x: 1, y: 0 }, cells: [0, 1, 2].map(x => ({ face: 0, x, y: 3 })) }] });

test('a departure atomically saves purple flips and removal, restores them, and resets on restart', async () => {
  const h = boot(null, { puzzleFactory: purplePuzzle });
  const playing = h.view.options.onSelect(0);
  assert.deepEqual(h.saves.at(-1).flippedRedirectors, [9]);
  assert.deepEqual(h.saves.at(-1).removed, [0]);
  const restored = boot(h.saves.at(-1), { puzzleFactory: purplePuzzle });
  assert.equal(restored.view.puzzle.redirectors[0].flipped, true);
  restored.get('loss-restart').click();
  assert.deepEqual(restored.saves.at(-1).flippedRedirectors, []);
  assert.equal(restored.view.puzzle.redirectors[0].flipped, false);
  h.view.animations.at(-1).resolve(true); await playing;
});

test('a collision never persists its temporary purple flips, including pagehide during rollback', async () => {
  const h = boot(null, { puzzleFactory: (size, seed) => {
    const puzzle = purplePuzzle(size, seed);
    puzzle.arrows.push({ id: 1, face: 0, direction: { x: 1, y: 0 }, cells: [3, 4, 5].map(x => ({ face: 0, x, y: 5 })) });
    return puzzle;
  } });
  const playing = h.view.options.onSelect(0), animation = h.view.animations.at(-1);
  assert.equal(animation.type, 'bump');
  animation.onImpact();
  h.pagehide();
  assert.deepEqual(h.saves.at(-1).flippedRedirectors, []);
  assert.equal(h.view.puzzle.redirectors[0].flipped, false);
  animation.resolve(true); await playing;
  assert.deepEqual(h.saves.at(-1).flippedRedirectors, []);
});

const lifePuzzle = (size, seed) => {
  const puzzle = twoEndedFixture(size, seed);
  puzzle.arrows.push({ id: 2, face: 2, direction: { x: 1, y: 0 }, cells: [0, 1, 2].map(x => ({ face: 2, x, y: 1 })) });
  return puzzle;
};
async function crash(h) {
  const playing = h.view.options.onSelect(0, false);
  const animation = h.view.animations.at(-1);
  assert.equal(animation.type, 'bump');
  animation.onImpact(); animation.onImpact();
  animation.resolve(false); await playing;
}

test('each crash costs a heart; the fifth opens loss only after rollback and persists immediately', async () => {
  const h = boot(null, { puzzleFactory: lifePuzzle });
  for (let attempt = 1; attempt <= 4; attempt++) {
    await crash(h);
    assert.equal(h.state().crashes, attempt);
    assert.equal(h.state().hearts, 5 - attempt);
    assert.equal(h.hearts.filter(icon => !icon.classes.has('empty')).length, 5 - attempt);
    assert.equal(h.state().lost, false);
    assert.equal(h.get('loss-dialog').open, false);
    assert.equal(h.state().resets.count, 4);
  }
  const playing = h.view.options.onSelect(0), animation = h.view.animations.at(-1);
  animation.onImpact(); animation.onImpact();
  assert.equal(h.state().crashes, 5);
  assert.equal(h.state().hearts, 0);
  assert(h.hearts.every(icon => icon.classes.has('empty')));
  assert.equal(h.saves.at(-1).crashes, 5, 'reload during rollback must not erase the loss');
  await h.view.options.onSelect(0);
  h.get('cube-stage').emit('keydown', { key: 'h' });
  assert.equal(h.get('loss-dialog').open, false, 'keep the collision animation visible');
  const restored = boot(h.saves.at(-1), { puzzleFactory: lifePuzzle });
  assert.equal(restored.get('loss-dialog').open, true);
  animation.resolve(false); await playing;
  assert.equal(h.get('loss-dialog').open, true);
  assert.equal(h.sounds.blocked, 5, 'each physical crash counts only once');
  assert.equal(h.state().moves, 0);
  assert.equal(h.state().resets.count, 4, 'never spend a reset automatically');
});

test('continuing spends exactly one reset and keeps board progress, while another loss needs an explicit choice', async () => {
  const h = boot(null, { puzzleFactory: lifePuzzle });
  const release = h.view.options.onSelect(2);
  h.view.animations.at(-1).resolve(true); await release;
  for (let i = 0; i < 5; i++) await crash(h);
  const before = h.state(), boardCalls = h.view.calls.length;
  h.get('use-reset').click(); h.get('use-reset').click();
  const continued = h.state();
  assert.equal(continued.crashes, 0);
  assert.equal(continued.resets.count, 3);
  assert(h.hearts.every(icon => !icon.classes.has('empty')));
  assert.equal(h.resetIcons.filter(icon => icon.classes.has('empty')).length, 2, 'one spent icon in both HUD and dialog');
  assert.equal(continued.resets.nextAt, 1800000000000 + lifeRules.RESET_RECOVERY_MS);
  for (const key of ['seed', 'generatorVersion', 'moves', 'removed', 'blocked', 'redirectors']) {
    assert.deepEqual(continued[key], before[key], key);
  }
  assert.equal(h.view.calls.length, boardCalls, 'continuing cannot generate or reset the puzzle');
  assert.equal(h.get('loss-dialog').open, false);
  const restored = boot(h.saves.at(-1), { puzzleFactory: lifePuzzle });
  assert.deepEqual(restored.state().resets, continued.resets);
  assert.deepEqual(restored.state().removed, [2]);
  for (let i = 0; i < 4; i++) { await crash(h); assert.equal(h.state().lost, false); }
  await crash(h);
  assert.equal(h.state().lost, true);
  assert.equal(h.state().resets.count, 3);
  h.advance(60 * 60 * 1000);
  h.get('use-reset').click();
  assert.deepEqual(h.state().resets, { count: 2, nextAt: continued.resets.nextAt });
});

test('with no resets, only a free same-puzzle restart resumes play and cannot refill the reset bank', async () => {
  const bank = { count: 0, nextAt: 1800000000000 + lifeRules.RESET_RECOVERY_MS };
  const h = boot(saveFor(5, 41, { crashes: 5, removed: [2], blocked: [0], moves: 1, resets: bank }), { puzzleFactory: lifePuzzle });
  const original = JSON.stringify(h.view.puzzle);
  assert.equal(h.get('loss-dialog').open, true);
  assert.equal(h.get('use-reset').hidden, true);
  h.get('use-reset').click();
  assert.equal(h.state().lost, true);
  assert.equal(h.get('loss-dialog').emit('cancel').defaultPrevented, false);
  h.get('loss-dialog').close();
  assert.equal(h.get('loss-dialog').open, false, 'dismissal returns to the same board');
  await h.view.options.onSelect(1);
  h.get('choose-size').click();
  assert.equal(h.view.animations.length, 0);
  assert.equal(h.get('difficulty-dialog').open, false);
  h.get('loss-restart').click();
  assert.equal(h.get('loss-dialog').open, false);
  assert.equal(h.state().lost, false);
  assert.equal(h.state().crashes, 0);
  assert.equal(h.state().moves, 0);
  assert.deepEqual(h.state().removed, []);
  assert.deepEqual(h.state().blocked, []);
  assert.deepEqual(h.state().resets, bank);
  assert.equal(JSON.stringify(h.view.puzzle), original);
  h.get('loss-restart').click(); h.submit(8);
  assert.deepEqual(h.state().resets, bank, 'restart and difficulty changes cannot refill resets');
});

test('recovery catches up after hidden or closed time, unlocks continue, and never resumes or spends automatically', () => {
  const now = 1800000000000, interval = lifeRules.RESET_RECOVERY_MS;
  const saved = saveFor(5, 41, { crashes: 5, resets: { count: 0, nextAt: now + interval } });
  const h = boot(saved, { puzzleFactory: lifePuzzle, now });
  assert.equal(h.get('use-reset').hidden, true);
  h.advance(interval - 1);
  assert.equal(h.state().resets.count, 0);
  h.advance(1);
  assert.equal(h.state().resets.count, 1);
  assert.equal(h.get('use-reset').hidden, false);
  assert.equal(h.state().lost, true);
  assert.equal(h.get('loss-dialog').open, true);
  h.visibility('hidden'); h.advance(2 * interval);
  assert.equal(h.state().resets.count, 1);
  h.visibility('visible');
  assert.equal(h.state().resets.count, 3);
  assert.equal(h.saves.at(-1).resets.count, 3);
  const reopened = boot(saved, { puzzleFactory: lifePuzzle, now: now + 20 * interval });
  assert.deepEqual(reopened.state().resets, { count: 4, nextAt: null });
  assert.equal(reopened.state().lost, true);
});

test('successful releases are unlimited and winning resets crashes without replenishing resets', async () => {
  const bank = { count: 2, nextAt: 1800000000000 + lifeRules.RESET_RECOVERY_MS };
  const h = boot(saveFor(5, 41, { crashes: 4, resets: bank }));
  const count = h.state().remaining;
  assert(count > 5);
  while (h.state().remaining) {
    const move = h.state().availableMoves[0];
    assert(move, 'the puzzle must stay solvable');
    const playing = h.view.options.onSelect(move.id, move.reverse);
    h.view.animations.at(-1).resolve(true); await playing;
    assert.equal(h.state().crashes, 4);
    assert.deepEqual(h.state().resets, bank);
  }
  assert.equal(h.state().moves, count);
  assert.equal(h.get('win-dialog').open, true);
  h.get('next-level').click();
  assert.equal(h.state().crashes, 0);
  assert.deepEqual(h.state().resets, bank);
});

test('a partial heart refill needs confirmation, consumes one reset, and preserves all progress', async () => {
  const h = boot(null, { puzzleFactory: lifePuzzle });
  h.get('reset-tokens').click();
  assert.equal(h.get('loss-dialog').open, true);
  assert.equal(h.get('use-reset').disabled, true, 'full hearts cannot waste a reset');
  h.get('use-reset').click();
  assert.equal(h.state().resets.count, 4);
  h.get('loss-close').click();
  assert.equal(h.get('loss-dialog').open, false);
  const releasing = h.view.options.onSelect(2);
  h.view.animations.at(-1).resolve(true); await releasing;
  await crash(h);
  const before = h.state();
  h.get('reset-tokens').click();
  assert.equal(h.get('use-reset').disabled, false);
  assert.notEqual(h.get('loss-restart').hidden, true);
  assert.equal(h.get('loss-dialog').emit('cancel').defaultPrevented, false);
  assert.equal(h.state().resets.count, 4, 'opening the refill prompt cannot spend');
  h.get('use-reset').click();
  assert.equal(h.state().hearts, 5);
  assert.equal(h.state().resets.count, 3);
  assert.deepEqual(h.state().removed, before.removed);
  assert.deepEqual(h.state().redirectors, before.redirectors);
  assert.equal(h.state().seed, before.seed);
});

test('settings contains working sound, animation, and difficulty controls without changing the current board', () => {
  const h = boot();
  const initial = h.state();
  h.get('settings').click();
  assert.equal(h.get('settings-dialog').open, true);
  h.get('sound').click();
  assert.equal(h.get('sound').getAttribute('aria-pressed'), 'false');
  assert.equal(h.get('sound').textContent, 'Off');
  assert.equal(h.saves.at(-1).sound, false);
  h.get('motion-select').value = 'reduced';
  h.get('motion-select').emit('change');
  assert.equal(h.view.motionMode, 'reduced');
  assert.equal(h.saves.at(-1).motion, 'reduced');
  h.get('choose-size').click();
  assert.equal(h.get('settings-dialog').open, false);
  assert.equal(h.get('difficulty-dialog').open, true);
  assert.equal(h.state().seed, initial.seed);
  assert.deepEqual(h.state().resets, initial.resets);
});

test('only the next empty reset icon fills; the tooltip and refill clock track the same deadline', () => {
  const now = 1800000000000, interval = lifeRules.RESET_RECOVERY_MS;
  const h = boot(saveFor(5, 41, { resets: { count: 1, nextAt: now + interval / 2 } }), { now });
  assert.deepEqual(h.resetIcons.map((icon, index) => icon.classes.has('recharging') ? index : -1).filter(i => i >= 0), [1, 5]);
  assert.equal(h.resetIcons[1].style['--reset-unfilled'], '50.00%');
  assert.equal(h.get('reset-recharge-progress').value, 50);
  assert.equal(h.get('reset-recharge-progress').hidden, false);
  assert.equal(h.get('reset-tokens').title, 'Next reset in 1:30:00');
  assert.equal(h.get('loss-recharge').textContent, h.get('reset-tokens').title);
  h.advance(interval / 4);
  assert.equal(h.resetIcons[1].style['--reset-unfilled'], '25.00%');
  h.advance(interval / 4);
  assert.equal(h.state().resets.count, 2);
  assert.equal(h.resetIcons[1].classes.has('empty'), false);
  assert.equal(h.resetIcons[1].classes.has('recharging'), false);
  assert.equal(h.resetIcons[2].classes.has('recharging'), true);
  assert.equal(h.resetIcons[2].style['--reset-unfilled'], '100.00%');
  h.advance(2 * interval);
  assert.equal(h.state().resets.count, 4);
  assert(h.resetIcons.every(icon => !icon.classes.has('empty') && !icon.classes.has('recharging')));
  assert.equal(h.get('reset-recharge-progress').hidden, true);
  assert.equal(h.get('reset-tokens').title, 'All resets ready');
});

test('Go back preserves a lost board while waiting, and a recovered reset resumes that exact game', async () => {
  const now = 1800000000000, interval = lifeRules.RESET_RECOVERY_MS;
  const h = boot(saveFor(5, 41, { crashes: 5, removed: [2], blocked: [0], moves: 1,
    resets: { count: 0, nextAt: now + interval } }), { now, puzzleFactory: lifePuzzle });
  const before = h.state(), boardCalls = h.view.calls.length;
  h.get('loss-close').click();
  assert.equal(h.get('loss-dialog').open, false);
  assert.deepEqual(h.state(), before, 'Go back cannot alter any puzzle or resource state');
  h.advance(interval / 2);
  assert.equal(h.get('loss-dialog').open, false, 'timer updates must not reopen the dialog');
  await h.view.options.onSelect(1);
  assert.equal(h.get('loss-dialog').open, true);
  assert.equal(h.view.animations.length, 0, 'no arrow can move with zero hearts');
  h.get('loss-close').click();
  h.advance(interval / 2);
  assert.equal(h.get('loss-dialog').open, false);
  assert.equal(h.state().resets.count, 1);
  assert.equal(h.state().hearts, 0, 'recovery never spends a reset automatically');
  await h.view.options.onSelect(1);
  assert.equal(h.get('loss-dialog').open, true);
  h.get('use-reset').click();
  assert.equal(h.state().hearts, 5);
  assert.equal(h.state().resets.count, 0);
  assert.equal(h.state().seed, before.seed);
  assert.deepEqual(h.state().removed, before.removed);
  assert.deepEqual(h.state().blocked, before.blocked);
  assert.equal(h.state().moves, before.moves);
  assert.equal(h.view.calls.length, boardCalls);
  const playing = h.view.options.onSelect(1);
  const animation = h.view.animations.at(-1);
  assert.equal(animation.type, 'remove');
  animation.resolve(true); await playing;
  assert(h.state().removed.includes(1));
});
