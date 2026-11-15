import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_THEME, normalizeTheme, hexToRgb, hexToHsv, hsvToHex } from '../src/theme.js';
import { normalizeProgress } from '../src/storage.js';

test('HSV conversions preserve every palette color and grayscale without channel drift', () => {
  for (let r = 0; r < 256; r += 17) for (let g = 0; g < 256; g += 17) for (let b = 0; b < 256; b += 17) {
    const hex = '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
    assert.equal(hsvToHex(hexToHsv(hex)), hex);
  }
  assert.equal(hexToHsv('#888888', 247).h, 247, 'gray retains the chosen hue for later saturation changes');
  assert.deepEqual(hexToRgb(DEFAULT_THEME.edge), [255, 255, 0]);
});

test('theme data permits only known six-digit hex colors and never discards puzzle progress', () => {
  const theme = normalizeTheme({ edge: '#ABC123', ink: 'url(https://invalid)', crash: null, arbitrary: '#123456' });
  assert.equal(theme.edge, '#abc123');
  assert.equal(theme.ink, DEFAULT_THEME.ink);
  assert.equal(theme.arbitrary, undefined);
  for (const badTheme of [null, [], 'red', { edge: 'red' }, { edge: '#fff;display:none' }]) {
    const saved = normalizeProgress({ size: 5, seed: 17, generatorVersion: 13, removed: [2], blocked: [3], moves: 1, crashes: 4,
      resets: { count: 2, nextAt: Date.now() + 100000 }, theme: badTheme });
    assert.deepEqual(saved.theme, DEFAULT_THEME);
    assert.deepEqual(saved.removed, [2]); assert.deepEqual(saved.blocked, [3]); assert.equal(saved.crashes, 4);
  }
});
