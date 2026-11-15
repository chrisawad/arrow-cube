import confetti from 'canvas-confetti';

/** Own one canvas for the win dialog's top layer, including immediate cleanup. */
export function createWinCelebration(canvas, {
  create = confetti.create, matchMedia = query => globalThis.matchMedia?.(query),
  setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  let fire;
  const timers = new Set();
  function stop() {
    for (const timer of timers) clearTimer(timer);
    timers.clear(); fire?.reset();
  }
  function later(callback, delay) {
    const timer = setTimer(() => { timers.delete(timer); callback(); }, delay);
    timers.add(timer);
  }
  function play() {
    stop();
    if (matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
    fire ??= create(canvas, { resize: true, useWorker: true, disableForReducedMotion: true });
    const colors = ['#6258f5', '#ffcc38', '#37b487', '#ff718b', '#74ccef', '#ffffff'];
    const burst = options => fire({ colors, spread: 85, ticks: 180, gravity: 1.05, scalar: 1.1, ...options });
    burst({ particleCount: 100, angle: 60, startVelocity: 55, origin: { x: .04, y: .8 } });
    burst({ particleCount: 100, angle: 120, startVelocity: 55, origin: { x: .96, y: .8 } });
    later(() => burst({ particleCount: 100, spread: 170, startVelocity: 32, origin: { x: .5, y: .25 } }), 260);
    later(() => {
      burst({ particleCount: 65, angle: 65, startVelocity: 42, origin: { x: .1, y: .65 } });
      burst({ particleCount: 65, angle: 115, startVelocity: 42, origin: { x: .9, y: .65 } });
    }, 550);
    // A short celebration; closing the dialog or starting another level stops it sooner.
    later(stop, 3800);
  }
  return { play, stop };
}
