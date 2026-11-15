import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio } from '../src/audio.js';

class Param {
  value = 0; events = [];
  setValueAtTime(value, at) { this.events.push({ type: 'set', value, at }); }
  linearRampToValueAtTime(value, at) { this.events.push({ type: 'linear', value, at }); }
  exponentialRampToValueAtTime(value, at) { this.events.push({ type: 'exponential', value, at }); }
  cancelScheduledValues(at) { this.canceled = at; }
}
class Node {
  connections = []; frequency = new Param(); gain = new Param(); Q = new Param(); stops = [];
  connect(node) { this.connections.push(node); return node; }
  disconnect() { this.disconnected = true; }
  setPeriodicWave(wave) { this.wave = wave; }
  start(at) { this.started = at; }
  stop(at = 0) { this.stops.push(at); }
}
function context() {
  const nodes = [], waves = [];
  const make = () => { const node = new Node(); nodes.push(node); return node; };
  return { currentTime: 10, state: 'running', destination: {}, nodes, waves,
    createOscillator: make, createGain: make, createBiquadFilter: make,
    createPeriodicWave(real, imaginary) { const wave = { real, imaginary }; waves.push(wave); return wave; },
    close() { this.closed = true; return Promise.resolve(); },
  };
}

function useContext(t, c) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: function () { return c; } });
  t.after(() => previous ? Object.defineProperty(globalThis, 'AudioContext', previous) : delete globalThis.AudioContext);
}

test('the trumpet fanfare articulates six brass notes and a final chord, then releases its audio nodes', t => {
  const audio = new GameAudio(), c = context(); useContext(t, c); audio.win();
  assert.equal(audio.horns.size, 8);
  assert(c.waves[0].imaginary.slice(2).some(value => value > .1), 'upper harmonics distinguish brass from the old sine chime');
  const horns = [...audio.horns];
  assert.deepEqual(horns.slice(0, 6).map(horn => horn.oscillator.started), [10, 10.18, 10.36, 10.57, 10.82, 11.07]);
  for (const horn of horns) {
    assert(horn.oscillator.wave);
    assert(horn.oscillator.stops[0] < 12);
    assert.equal(horn.gain.gain.events.at(-1).value, 0, 'every trumpet note has a click-free release');
    horn.oscillator.onended();
    assert(horn.nodes.every(node => node.disconnected));
  }
  assert.equal(audio.horns.size, 0);
});

test('mute, another win, and disposal cancel scheduled trumpet notes without leaving a persistent graph', t => {
  const audio = new GameAudio(), c = context(); useContext(t, c);
  audio.win(); const old = [...audio.horns]; audio.win();
  assert(old.every(horn => horn.nodes.every(node => node.disconnected)));
  assert.equal(audio.horns.size, 8, 'repeated celebrations replace the previous fanfare');
  const playing = [...audio.horns]; audio.setEnabled(false);
  assert.equal(audio.horns.size, 0);
  assert(playing.every(horn => horn.gain.gain.value === 0 && horn.oscillator.stops.at(-1) === 0));
  const created = c.nodes.length; audio.win(); assert.equal(c.nodes.length, created, 'muted wins create no notes');
  audio.setEnabled(true); audio.win(); audio.dispose();
  assert.equal(audio.horns.size, 0); assert(c.closed);
});
