import { getGridSizeForVersion } from './cube-surface.js';
import { recoverLives, normalizeCrashes } from './lives.js';

export const STORAGE_KEY = 'arrow-cube-progress-v1';
const VERSION = 1;

function validId(id) {
  return (Number.isSafeInteger(id) && id >= 0) ||
    (typeof id === 'string' && id.length > 0 && id.length <= 80);
}

/** Treat storage as untrusted input. Return null rather than breaking game startup. */
export function normalizeProgress(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.version !== undefined && value.version !== VERSION) return null;
  // Generator identity is separate from storage schema: old seeds must recreate
  // their original board so saved removed IDs still refer to the same arrows.
  const generatorVersion = value.generatorVersion === undefined ? 1 : value.generatorVersion;
  if (!Number.isInteger(generatorVersion) || generatorVersion < 1 || generatorVersion > 13) return null;
  if (!Number.isInteger(value.size) || value.size < 2 || value.size > 64) return null;
  const seedValid = (Number.isSafeInteger(value.seed) && value.seed >= 0 && value.seed <= 0xffffffff) ||
    (typeof value.seed === 'string' && value.seed.length > 0 && value.seed.length <= 128);
  const gridSize = getGridSizeForVersion(value.size, generatorVersion);
  if (!seedValid || !Array.isArray(value.removed) || value.removed.length > 6 * gridSize ** 2) return null;
  if (!value.removed.every(validId)) return null;
  const removed = [...new Set(value.removed)];
  const blockedValue = value.blocked === undefined ? [] : value.blocked;
  if (!Array.isArray(blockedValue) || blockedValue.length > 6 * gridSize ** 2 || !blockedValue.every(validId)) return null;
  const blocked = [...new Set(blockedValue)];
  const flippedValue = value.flippedRedirectors === undefined ? [] : value.flippedRedirectors;
  if (!Array.isArray(flippedValue) || flippedValue.length > 32 || !flippedValue.every(validId)) return null;
  const flippedRedirectors = [...new Set(flippedValue)];
  if (!Number.isSafeInteger(value.moves) || value.moves < 0 || value.moves > 100000000) return null;
  const bestSize = Number.isInteger(value.bestSize) && value.bestSize >= value.size && value.bestSize <= 64
    ? value.bestSize : value.size;
  const motion = ['auto', 'full', 'reduced'].includes(value.motion) ? value.motion : 'full';
  return { version: VERSION, generatorVersion, size: value.size, seed: value.seed, removed, blocked,
    flippedRedirectors, moves: value.moves, sound: value.sound !== false, bestSize, motion,
    crashes: normalizeCrashes(value.crashes), lives: recoverLives(value.lives) };
}

export function loadProgress() {
  try {
    const raw = globalThis.localStorage.getItem(STORAGE_KEY);
    if (!raw || raw.length > 1000000) return null;
    const value = JSON.parse(raw);
    if (value.version !== VERSION) return null;
    return normalizeProgress(value);
  } catch { return null; }
}

export function saveProgress(value) {
  const normalized = normalizeProgress(value);
  if (!normalized) return false;
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return true;
  } catch { return false; }
}
