import test from 'node:test';
import assert from 'node:assert/strict';
import { loadProgress, saveProgress, normalizeProgress, STORAGE_KEY } from '../src/storage.js';

const valid = () => ({ size: 5, seed: 123456, removed: ['0-1', 3], moves: 2, sound: false, bestSize: 8 });
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
