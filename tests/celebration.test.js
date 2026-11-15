import test from 'node:test';
import assert from 'node:assert/strict';
import { createWinCelebration } from '../src/celebration.js';

function fixture(reduced = false) {
  const jobs = new Map(), shots = [], creations = [], canvas = {};
  let now = 0, id = 0, resets = 0;
  const fire = options => shots.push(options); fire.reset = () => resets++;
  const celebration = createWinCelebration(canvas, {
    create(target, options) { creations.push({ target, options }); return fire; },
    matchMedia: () => ({ matches: reduced }),
    setTimer(callback, delay) { jobs.set(++id, { callback, at: now + delay }); return id; },
    clearTimer: id => jobs.delete(id),
  });
  return { celebration, shots, jobs, creations, canvas, get resets() { return resets; },
    advance(until) {
      while (true) {
        const next = [...jobs].filter(([, job]) => job.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        jobs.delete(next[0]); now = next[1].at; next[1].callback();
      }
      now = until;
    },
  };
}

test('confetti covers both sides and the center, reuses its responsive canvas, and finishes within four seconds', () => {
  const h = fixture(); h.celebration.play();
  assert.equal(h.creations[0].target, h.canvas);
  assert.deepEqual(h.creations[0].options, { resize: true, useWorker: true, disableForReducedMotion: true });
  assert.deepEqual(h.shots.map(shot => shot.origin.x), [.04, .96]);
  h.advance(550);
  assert.equal(h.shots.length, 5); assert(h.shots.some(shot => shot.origin.x === .5));
  h.advance(3800); assert.equal(h.jobs.size, 0); assert.equal(h.resets, 1);
  h.celebration.play(); assert.equal(h.creations.length, 1, 'never transfer the same canvas to another worker');
  h.celebration.stop(); assert.equal(h.jobs.size, 0);
});

test('closing the celebration cancels every delayed burst and clears particles immediately', () => {
  const h = fixture(); h.celebration.play(); h.celebration.stop(); h.advance(5000);
  assert.equal(h.shots.length, 2); assert.equal(h.resets, 1); assert.equal(h.jobs.size, 0);
});

test('reduced motion keeps the static achievement screen without creating particles or timers', () => {
  const h = fixture(true); h.celebration.play();
  assert.equal(h.shots.length, 0); assert.equal(h.creations.length, 0); assert.equal(h.jobs.size, 0);
});
