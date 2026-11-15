import test from 'node:test';
import assert from 'node:assert/strict';
import { loadProgress, saveProgress, normalizeProgress, STORAGE_KEY } from '../src/storage.js';

const valid = () => ({ generatorVersion: 13, flippedRedirectors: [], size: 5, seed: 123456, removed: ['0-1', 3], blocked: [], moves: 2, sound: false, bestSize: 8, motion: 'auto', crashes: 0, resets: { count: 4, nextAt: null } });
test('progress round trips the puzzle seed, removed paths, dimension, and settings', () => {
  const values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.equal(saveProgress(valid()), true);
  assert.deepEqual(loadProgress(), { version: 1, ...valid() });
  assert.ok(values.has(STORAGE_KEY));
});
test('malformed, incompatible, or oversized saves fail closed', () => {
  globalThis.localStorage = { getItem: () => '{corrupt' };
  assert.equal(loadProgress(), null);
  for (const invalid of [{...valid(), version: 22}, {...valid(), size: 100000}, {...valid(), seed: {}}, {...valid(), removed: [{}]}, {...valid(), moves: -1}]) {
    assert.equal(normalizeProgress(invalid), null);
  }
});
test('storage denial or a full quota does not crash play', () => {
  globalThis.localStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  assert.equal(loadProgress(), null);
  assert.equal(saveProgress(valid()), false);
});

test('motion choices persist and legacy or malformed choices use full animation', () => {
  let stored;
  globalThis.localStorage = { getItem: () => stored, setItem: (_key, value) => { stored = value; } };
  for (const motion of ['full', 'reduced', 'auto']) {
    assert.equal(saveProgress({ ...valid(), motion }), true);
    assert.equal(loadProgress().motion, motion);
  }
  for (const motion of [undefined, null, false, {}, 'invalid']) {
    assert.equal(normalizeProgress({ ...valid(), motion }).motion, 'full');
  }
});
test('duplicate removed IDs are normalized and an invalid best dimension is repaired', () => {
  const result = normalizeProgress({...valid(), removed: [1, 1, '2', '2'], bestSize: -1});
  assert.deepEqual(result.removed, [1, '2']);
  assert.equal(result.bestSize, 5);
});
test('stored dimensions cannot exceed the engine limit, including a plausible off-by-one save', () => {
  globalThis.localStorage = { getItem: () => JSON.stringify({ version: 1, ...valid(), size: 65, bestSize: 65 }) };
  assert.equal(loadProgress(), null);
  assert.equal(normalizeProgress({ ...valid(), size: 64, bestSize: 64 }).size, 64);
  assert.equal(normalizeProgress({ ...valid(), size: 65, bestSize: 65 }), null);
  assert.equal(normalizeProgress({ ...valid(), bestSize: 65 }).bestSize, 5);
});
test('legacy saves retain their original generator, seed, dimension, and removed arrow IDs', () => {
  const legacy = { version: 1, size: 12, seed: 48617, removed: [0, 5, 23, 89], moves: 4, sound: true, bestSize: 18 };
  let stored = JSON.stringify(legacy);
  globalThis.localStorage = { getItem: () => stored, setItem: (_key, value) => { stored = value; } };
  const restored = loadProgress();
  assert.deepEqual(restored, { ...legacy, generatorVersion: 1, blocked: [], flippedRedirectors: [], motion: 'full', crashes: 0, resets: { count: 4, nextAt: null } });
  assert.equal(saveProgress(restored), true);
  assert.deepEqual(JSON.parse(stored), { ...legacy, generatorVersion: 1, blocked: [], flippedRedirectors: [], motion: 'full', crashes: 0, resets: { count: 4, nextAt: null } });
});
test('current generator version round trips without changing the existing storage schema or key', () => {
  let stored;
  globalThis.localStorage = {
    getItem: key => { assert.equal(key, 'arrow-cube-progress-v1'); return stored; },
    setItem: (key, value) => { assert.equal(key, 'arrow-cube-progress-v1'); stored = value; },
  };
  assert.equal(saveProgress(valid()), true);
  assert.equal(JSON.parse(stored).version, 1);
  assert.equal(JSON.parse(stored).generatorVersion, 13);
  assert.deepEqual(loadProgress(), { version: 1, ...valid() });
});
test('explicit generator 1 through 11 saves remain compatible', () => {
  for (const generatorVersion of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
    let stored = JSON.stringify({ version: 1, ...valid(), generatorVersion });
    globalThis.localStorage = { getItem: () => stored, setItem: (_key, value) => { stored = value; } };
    const restored = loadProgress();
    assert.equal(restored.generatorVersion, generatorVersion);
    assert.equal(saveProgress(restored), true);
    assert.deepEqual(loadProgress(), restored);
  }
});
test('generators 3, 4, and 5 use doubled grid capacity without changing the displayed dimension', () => {
  for (const generatorVersion of [3, 4, 5]) {
    const dense = { ...valid(), generatorVersion, size: 4, bestSize: 4, removed: Array.from({length: 120}, (_, id) => id), moves: 120 };
    let stored;
    globalThis.localStorage = { getItem: () => stored, setItem: (_key, value) => { stored = value; } };
    assert.equal(saveProgress(dense), true);
    assert.equal(loadProgress().size, 4);
    assert.equal(loadProgress().generatorVersion, generatorVersion);
    assert.deepEqual(loadProgress().removed, dense.removed);
    assert.equal(normalizeProgress({ ...dense, generatorVersion: 2 }), null);
    assert.equal(normalizeProgress({ ...dense, removed: Array.from({length: 6 * 8 ** 2 + 1}, (_, id) => id) }), null);
  }
});
test('generators 6 through 12 validate actual lane capacity instead of the earlier doubled grid', () => {
  for (const generatorVersion of [6, 7, 8, 9, 10, 11, 12]) for (const size of [2, 3, 6, 8, 64]) {
    const gridSize = Math.max(4, Math.round(size * 1.6));
    const removed = Array.from({ length: 6 * gridSize ** 2 }, (_, id) => id);
    const progress = { ...valid(), generatorVersion, size, bestSize: size, removed, moves: removed.length };
    const normalized = normalizeProgress(progress);
    assert.equal(normalized.size, size);
    assert.deepEqual(normalized.removed, removed);
    assert.equal(normalizeProgress({ ...progress, removed: [...removed, removed.length] }), null);
    if (size > 2) {
      const oldGridCapacity = Array.from({ length: 6 * (size * 2) ** 2 }, (_, id) => id);
      assert.equal(normalizeProgress({ ...progress, gridSize: size * 2, removed: oldGridCapacity }), null);
    }
  }
});
test('blocked path IDs persist, deduplicate, and default to empty for older saves', () => {
  let stored;
  globalThis.localStorage = { getItem: () => stored, setItem: (_key, value) => { stored = value; } };
  assert.equal(saveProgress({ ...valid(), blocked: [4, 4, 'path-8', 'path-8'] }), true);
  assert.deepEqual(loadProgress().blocked, [4, 'path-8']);
  const oldSave = valid();
  delete oldSave.blocked;
  assert.deepEqual(normalizeProgress(oldSave).blocked, []);
  for (const blocked of [null, {}, [NaN], [-1], [''], [false], Array.from({ length: 6 * 8 ** 2 + 1 }, (_, id) => id)]) {
    assert.equal(normalizeProgress({ ...valid(), blocked }), null);
  }
});
test('unknown generator versions are rejected rather than restoring arrow IDs onto a different puzzle', () => {
  for (const generatorVersion of [0, 14, -1, 1.5, '12', null, {}]) {
    const unknown = { version: 1, ...valid(), generatorVersion };
    globalThis.localStorage = { getItem: () => JSON.stringify(unknown) };
    assert.equal(loadProgress(), null);
    assert.equal(normalizeProgress(unknown), null);
    assert.equal(saveProgress(unknown), false);
  }
});

test('purple marker orientations round trip, deduplicate, default for older saves, and reject invalid IDs', () => {
  let stored;
  globalThis.localStorage = { getItem: () => stored, setItem: (_key, value) => { stored = value; } };
  assert(saveProgress({ ...valid(), flippedRedirectors: [1, 1, 4] }));
  assert.deepEqual(loadProgress().flippedRedirectors, [1, 4]);
  assert.deepEqual(normalizeProgress({ ...valid(), generatorVersion: 12, flippedRedirectors: undefined }).flippedRedirectors, []);
  for (const flippedRedirectors of [null, {}, [-1], [NaN], [''], [false], Array(33).fill(1)]) {
    assert.equal(normalizeProgress({ ...valid(), flippedRedirectors }), null);
  }
});

test('loss and recovery deadlines round trip and restore earned resets without changing the saved puzzle', () => {
  const now = Date.now(), interval = 3 * 60 * 60 * 1000;
  const progress = { ...valid(), crashes: 5, resets: { count: 2, nextAt: now + interval } };
  let stored;
  globalThis.localStorage = { getItem: () => stored, setItem: (_key, value) => { stored = value; } };
  assert.equal(saveProgress(progress), true);
  assert.deepEqual(loadProgress(), { version: 1, ...progress });
  stored = JSON.stringify({ version: 1, ...progress, resets: { count: 0, nextAt: now - 2 * interval - 1000 } });
  const restored = loadProgress();
  assert.equal(restored.resets.count, 3);
  assert.equal(restored.resets.nextAt, now + interval - 1000);
  assert.equal(restored.crashes, 5);
  assert.equal(restored.seed, progress.seed);
  assert.deepEqual(restored.removed, progress.removed);
});

test('old life and sixth-crash saves migrate to four resets and zero hearts on the same board', () => {
  const progress = { ...valid(), crashes: 6, lives: { count: 4, nextAt: null } };
  delete progress.resets;
  const restored = normalizeProgress(progress);
  assert.equal(restored.crashes, 5);
  assert.deepEqual(restored.resets, { count: 4, nextAt: null });
  assert.equal(restored.seed, progress.seed);
  assert.deepEqual(restored.removed, progress.removed);
  assert.equal(restored.lives, undefined, 'do not retain two competing resource balances');
});
