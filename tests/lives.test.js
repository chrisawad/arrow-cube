import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverResets, restoreResets, spendReset, recoveryCountdown, normalizeCrashes, RESET_RECOVERY_MS as INTERVAL } from '../src/lives.js';

const now = 1800000000000;

test('new and malformed banks start with three resets; no recovery time is banked at the cap', () => {
  for (const value of [undefined, null, {}, [], { count: -1 }, { count: 6 }, { count: NaN }, { count: '3' }]) {
    assert.deepEqual(recoverResets(value, now), { count: 3, nextAt: null });
  }
  assert.deepEqual(recoverResets({ count: 3, nextAt: now - 100 * INTERVAL }, now), { count: 3, nextAt: null });
  assert.deepEqual(spendReset({ count: 3, nextAt: now - INTERVAL }, now), { count: 2, nextAt: now + INTERVAL });
});

test('one reset returns on each three-hour boundary, including multiple offline intervals', () => {
  const bank = { count: 0, nextAt: now + INTERVAL };
  assert.deepEqual(recoverResets(bank, now + INTERVAL - 1), bank);
  assert.deepEqual(recoverResets(bank, now + INTERVAL), { count: 1, nextAt: now + 2 * INTERVAL });
  assert.deepEqual(recoverResets(bank, now + 3.5 * INTERVAL), { count: 3, nextAt: null });
  assert.deepEqual(recoverResets(bank, now + 20 * INTERVAL), { count: 3, nextAt: null });
});

test('spending uses one reset, preserves partial recovery, and cannot spend below zero', () => {
  const first = spendReset(undefined, now);
  assert.deepEqual(first, { count: 2, nextAt: now + INTERVAL });
  const second = spendReset(first, now + INTERVAL / 2);
  assert.deepEqual(second, { count: 1, nextAt: first.nextAt });
  assert.deepEqual(first, { count: 2, nextAt: now + INTERVAL }, 'do not mutate the caller');
  assert.equal(spendReset({ count: 0, nextAt: now + INTERVAL }, now), null);
  assert.deepEqual(spendReset({ count: 0, nextAt: now }, now), { count: 0, nextAt: now + INTERVAL });
});

test('missing deadlines and backward clock corrections never strand a depleted bank', () => {
  for (const nextAt of [undefined, null, NaN, -1, 'later', now + 20 * INTERVAL]) {
    assert.deepEqual(recoverResets({ count: 2, nextAt }, now), { count: 2, nextAt: now + INTERVAL });
  }
});

test('countdown rounds up at boundaries and crash normalization preserves loss', () => {
  assert.equal(recoveryCountdown({ nextAt: null }, now), 'All resets ready');
  assert.equal(recoveryCountdown({ nextAt: now + INTERVAL }, now), 'Next reset in 3:00:00');
  assert.equal(recoveryCountdown({ nextAt: now + 1 }, now), 'Next reset in 0:00:01');
  assert.equal(recoveryCountdown({ nextAt: now - 1 }, now), 'Next reset in 0:00:00');
  assert.equal(normalizeCrashes(5), 5);
  assert.equal(normalizeCrashes(6), 5);
  assert.equal(normalizeCrashes(100), 5);
  for (const value of [undefined, -1, 1.5, '6', NaN]) assert.equal(normalizeCrashes(value), 0);
});

test('old life balances become at most three reset tokens without erasing a partial recovery interval', () => {
  for (const count of [0, 1, 2, 3, 4, 5]) {
    const migrated = restoreResets({ lives: { count, nextAt: now + INTERVAL / 2 } }, now);
    assert.deepEqual(migrated, { count: Math.min(3, count), nextAt: count < 3 ? now + INTERVAL / 2 : null });
  }
  assert.deepEqual(restoreResets({ resets: { count: 1, nextAt: now + INTERVAL }, lives: { count: 5 } }, now),
    { count: 1, nextAt: now + INTERVAL }, 'new saves take precedence over old fields');
});
