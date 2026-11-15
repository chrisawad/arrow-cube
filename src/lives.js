export const MAX_HEARTS = 5;
export const MAX_RESETS = 3;
export const RESET_RECOVERY_MS = 3 * 60 * 60 * 1000;

/** Recover from wall-clock deadlines, including time spent with the app closed. */
export function recoverResets(value, now = Date.now()) {
  const count = Number.isInteger(value?.count) && value.count >= 0 && value.count <= MAX_RESETS
    ? value.count : MAX_RESETS;
  if (count === MAX_RESETS) return { count, nextAt: null };
  // A missing deadline starts a fresh interval. A clock correction must not
  // leave a player waiting longer than a full recovery interval.
  const nextAt = Number.isSafeInteger(value?.nextAt) && value.nextAt >= 0
    ? Math.min(value.nextAt, now + RESET_RECOVERY_MS) : now + RESET_RECOVERY_MS;
  if (now < nextAt) return { count, nextAt };
  const earned = Math.floor((now - nextAt) / RESET_RECOVERY_MS) + 1;
  const recovered = Math.min(MAX_RESETS, count + earned);
  return { count: recovered, nextAt: recovered === MAX_RESETS ? null : nextAt + earned * RESET_RECOVERY_MS };
}

/** Preserve old life balances and deadlines when upgrading to reset tokens. */
export function restoreResets(progress, now = Date.now()) {
  if (progress?.resets !== undefined) return recoverResets(progress.resets, now);
  const legacy = progress?.lives;
  if (Number.isInteger(legacy?.count) && legacy.count >= 0 && legacy.count <= 5) {
    return recoverResets({ count: Math.min(MAX_RESETS, legacy.count), nextAt: legacy.nextAt }, now);
  }
  return recoverResets(undefined, now);
}

/** Spending again preserves an already-running recovery interval. */
export function spendReset(value, now = Date.now()) {
  const bank = recoverResets(value, now);
  if (bank.count === 0) return null;
  return { count: bank.count - 1, nextAt: bank.nextAt ?? now + RESET_RECOVERY_MS };
}

export function normalizeCrashes(value) {
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, MAX_HEARTS) : 0;
}

export function resetRechargeFraction(bank, now = Date.now()) {
  if (bank.nextAt === null) return 0;
  return Math.max(0, Math.min(1, 1 - (bank.nextAt - now) / RESET_RECOVERY_MS));
}

export function recoveryCountdown(bank, now = Date.now()) {
  if (bank.nextAt === null) return 'All resets ready';
  const seconds = Math.max(0, Math.ceil((bank.nextAt - now) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = String(Math.floor(seconds / 60) % 60).padStart(2, '0');
  return `Next reset in ${hours}:${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
