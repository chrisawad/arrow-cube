import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverLives, spendLife, recoveryCountdown, normalizeCrashes, LIFE_RECOVERY_MS as INTERVAL } from '../src/lives.js';

const now = 1800000000000;

test('new and malformed banks start with five lives; no recovery time is banked at the cap', () => {
  for (const value of [undefined, null, {}, [], { count: -1 }, { count: 6 }, { count: NaN }, { count: '3' }]) {
    assert.deepEqual(recoverLives(value, now), { count: 5, nextAt: null });
  }
  assert.deepEqual(recoverLives({ count: 5, nextAt: now - 100 * INTERVAL }, now), { count: 5, nextAt: null });
  assert.deepEqual(spendLife({ count: 5, nextAt: now - INTERVAL }, now), { count: 4, nextAt: now + INTERVAL });
});

test('one life returns on each three-hour boundary, including multiple offline intervals', () => {
  const bank = { count: 0, nextAt: now + INTERVAL };
  assert.deepEqual(recoverLives(bank, now + INTERVAL - 1), bank);
  assert.deepEqual(recoverLives(bank, now + INTERVAL), { count: 1, nextAt: now + 2 * INTERVAL });
  assert.deepEqual(recoverLives(bank, now + 3.5 * INTERVAL), { count: 3, nextAt: now + 4 * INTERVAL });
  assert.deepEqual(recoverLives(bank, now + 20 * INTERVAL), { count: 5, nextAt: null });
});

test('spending uses one life, preserves partial recovery, and cannot spend below zero', () => {
  const first = spendLife(undefined, now);
  assert.deepEqual(first, { count: 4, nextAt: now + INTERVAL });
  const second = spendLife(first, now + INTERVAL / 2);
  assert.deepEqual(second, { count: 3, nextAt: first.nextAt });
  assert.deepEqual(first, { count: 4, nextAt: now + INTERVAL }, 'do not mutate the caller');
  assert.equal(spendLife({ count: 0, nextAt: now + INTERVAL }, now), null);
  assert.deepEqual(spendLife({ count: 0, nextAt: now }, now), { count: 0, nextAt: now + INTERVAL });
});

test('missing deadlines and backward clock corrections never strand a depleted bank', () => {
  for (const nextAt of [undefined, null, NaN, -1, 'later', now + 20 * INTERVAL]) {
    assert.deepEqual(recoverLives({ count: 2, nextAt }, now), { count: 2, nextAt: now + INTERVAL });
  }
});

test('countdown rounds up at boundaries and crash normalization preserves loss', () => {
  assert.equal(recoveryCountdown({ nextAt: null }, now), 'All lives ready');
  assert.equal(recoveryCountdown({ nextAt: now + INTERVAL }, now), 'Next life in 3:00:00');
  assert.equal(recoveryCountdown({ nextAt: now + 1 }, now), 'Next life in 0:00:01');
  assert.equal(recoveryCountdown({ nextAt: now - 1 }, now), 'Next life in 0:00:00');
  assert.equal(normalizeCrashes(5), 5);
  assert.equal(normalizeCrashes(6), 6);
  assert.equal(normalizeCrashes(100), 6);
  for (const value of [undefined, -1, 1.5, '6', NaN]) assert.equal(normalizeCrashes(value), 0);
});
