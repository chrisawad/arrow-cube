export const MAX_LIVES = 5;
export const CRASH_LIMIT = 5;
export const LIFE_RECOVERY_MS = 3 * 60 * 60 * 1000;

/** Recover from wall-clock deadlines, including time spent with the app closed. */
export function recoverLives(value, now = Date.now()) {
  const count = Number.isInteger(value?.count) && value.count >= 0 && value.count <= MAX_LIVES
    ? value.count : MAX_LIVES;
  if (count === MAX_LIVES) return { count, nextAt: null };
  // A missing deadline starts a fresh interval. A clock correction must not
  // leave a player waiting longer than a full recovery interval.
  const nextAt = Number.isSafeInteger(value?.nextAt) && value.nextAt >= 0
    ? Math.min(value.nextAt, now + LIFE_RECOVERY_MS) : now + LIFE_RECOVERY_MS;
  if (now < nextAt) return { count, nextAt };
  const earned = Math.floor((now - nextAt) / LIFE_RECOVERY_MS) + 1;
  const recovered = Math.min(MAX_LIVES, count + earned);
  return { count: recovered, nextAt: recovered === MAX_LIVES ? null : nextAt + earned * LIFE_RECOVERY_MS };
}

/** Spending again preserves an already-running recovery interval. */
export function spendLife(value, now = Date.now()) {
  const bank = recoverLives(value, now);
  if (bank.count === 0) return null;
  return { count: bank.count - 1, nextAt: bank.nextAt ?? now + LIFE_RECOVERY_MS };
}

export function normalizeCrashes(value) {
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, CRASH_LIMIT + 1) : 0;
}

export function recoveryCountdown(bank, now = Date.now()) {
  if (bank.nextAt === null) return 'All lives ready';
  const seconds = Math.max(0, Math.ceil((bank.nextAt - now) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = String(Math.floor(seconds / 60) % 60).padStart(2, '0');
  return `Next life in ${hours}:${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
