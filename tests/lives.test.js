import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverResets, restoreResets, spendReset, recoveryCountdown, normalizeCrashes, resetRechargeFraction, RESET_RECOVERY_MS as INTERVAL } from '../src/lives.js';

const now = 1800000000000;

test('new and malformed banks start with six resets; no recovery time is banked at the cap', () => {
  for (const value of [undefined, null, {}, [], { count: -1 }, { count: 7 }, { count: NaN }, { count: '3' }]) {
    assert.deepEqual(recoverResets(value, now), { count: 6, nextAt: null });
  }
  assert.deepEqual(recoverResets({ count: 6, nextAt: now - 100 * INTERVAL }, now), { count: 6, nextAt: null });
  assert.deepEqual(spendReset({ count: 6, nextAt: now - INTERVAL }, now), { count: 5, nextAt: now + INTERVAL });
});

test('one reset returns on each three-hour boundary, including multiple offline intervals', () => {
  const bank = { count: 0, nextAt: now + INTERVAL };
  assert.deepEqual(recoverResets(bank, now + INTERVAL - 1), bank);
  assert.deepEqual(recoverResets(bank, now + INTERVAL), { count: 1, nextAt: now + 2 * INTERVAL });
  assert.deepEqual(recoverResets(bank, now + 3.5 * INTERVAL), { count: 3, nextAt: now + 4 * INTERVAL });
  assert.deepEqual(recoverResets(bank, now + 20 * INTERVAL), { count: 6, nextAt: null });
});

test('spending uses one reset, preserves partial recovery, and cannot spend below zero', () => {
  const first = spendReset(undefined, now);
  assert.deepEqual(first, { count: 5, nextAt: now + INTERVAL });
  const second = spendReset(first, now + INTERVAL / 2);
  assert.deepEqual(second, { count: 4, nextAt: first.nextAt });
  assert.deepEqual(first, { count: 5, nextAt: now + INTERVAL }, 'do not mutate the caller');
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

test('old life balances migrate without erasing a partial recovery interval', () => {
  for (const count of [0, 1, 2, 3, 4, 5]) {
    const migrated = restoreResets({ lives: { count, nextAt: now + INTERVAL / 2 } }, now);
    assert.deepEqual(migrated, count < 4 ? { count, nextAt: now + INTERVAL / 2 } : { count: 6, nextAt: null });
  }
  assert.deepEqual(restoreResets({ resets: { count: 1, nextAt: now + INTERVAL }, lives: { count: 5 } }, now),
    { count: 1, nextAt: now + INTERVAL }, 'new saves take precedence over old fields');
});

test('recharge fill follows the current deadline and stays between empty and full', () => {
  assert.equal(resetRechargeFraction({ nextAt: null }, now), 0);
  assert.equal(resetRechargeFraction({ nextAt: now + INTERVAL }, now), 0);
  assert.equal(resetRechargeFraction({ nextAt: now + INTERVAL / 2 }, now), 0.5);
  assert.equal(resetRechargeFraction({ nextAt: now }, now), 1);
  assert.equal(resetRechargeFraction({ nextAt: now - 1 }, now), 1);
  assert.equal(resetRechargeFraction({ nextAt: now + 2 * INTERVAL }, now), 0);
});

test('old full banks upgrade to six resets and partially depleted banks keep their deadline', () => {
  for (const count of [3, 4]) {
    assert.deepEqual(restoreResets({ resets: { count, nextAt: null } }, now), { count: 6, nextAt: null });
  }
  for (const count of [0, 1, 2, 3, 4, 5]) {
    const bank = { count, nextAt: now + INTERVAL / 2 };
    assert.deepEqual(restoreResets({ resets: bank }, now), bank);
  }
});
