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
  const nodes = [], waves = [], sources = [];
  const make = () => { const node = new Node(); nodes.push(node); return node; };
  return { currentTime: 10, state: 'running', destination: {}, nodes, waves, sources,
    createOscillator: make, createGain: make, createBiquadFilter: make,
    createBufferSource() { const source = make(); sources.push(source); return source; },
    decodeAudioData() { return Promise.resolve({ duration: 1.1 }); },
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

test('the bundled win recording loads on interaction, stays cached, and speaks before the trumpet', async t => {
  const c = context(); useContext(t, c);
  let fetches = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    fetches++; assert.equal(url, './audio/you-win.wav');
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
  });
  const audio = new GameAudio(true, { winVoiceURL: './audio/you-win.wav' });
  assert.equal(fetches, 0, 'initializing the game does not delay startup with a media request');
  audio.prepare(); await audio.voiceLoading;
  audio.prepare(); assert.equal(fetches, 1);
  audio.win();
  assert.equal(c.sources.length, 1); assert.equal(c.sources[0].started, 10);
  assert.equal(c.sources[0].buffer.duration, 1.1);
  assert([...audio.horns].every(horn => horn.oscillator.started >= 11.22), 'the fanfare cannot mask the words');
  c.sources[0].onended(); assert.equal(audio.voicePlayback, null);
  audio.dispose();
});

test('leaving the win screen or muting cannot trigger late speech when decoding finishes', async t => {
  const c = context(); useContext(t, c);
  let decoded;
  c.decodeAudioData = () => new Promise(resolve => { decoded = resolve; });
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }));
  const audio = new GameAudio(true, { winVoiceURL: './audio/you-win.wav' });
  audio.win(); const loading = audio.voiceLoading;
  await new Promise(resolve => setImmediate(resolve));
  audio.stopWin(); decoded({ duration: 1 }); await loading;
  assert.equal(c.sources.length, 0); assert.equal(audio.horns.size, 0);
  audio.win(); assert.equal(c.sources.length, 1);
  audio.setEnabled(false);
  assert.equal(c.sources[0].stops.at(-1), 0); assert(c.sources[0].disconnected);
  assert.equal(audio.voicePlayback, null); assert.equal(audio.horns.size, 0);
});

test('a missing recording falls back to the fanfare, and a muted game makes no media request', async t => {
  const c = context(); useContext(t, c);
  t.mock.method(console, 'warn', () => {});
  let fetches = 0;
  t.mock.method(globalThis, 'fetch', async () => { fetches++; return { ok: false }; });
  const audio = new GameAudio(false, { winVoiceURL: './audio/you-win.wav' });
  audio.prepare(); audio.win(); assert.equal(fetches, 0);
  audio.setEnabled(true); audio.win(); await audio.voiceLoading;
  assert.equal(c.sources.length, 0); assert.equal(audio.horns.size, 8);
  audio.dispose();
});

test('a stalled voice request times out so a win still gets its fanfare', async t => {
  const c = context(); useContext(t, c);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('Timed out')), { once: true });
  }));
  const audio = new GameAudio(true, { winVoiceURL: './audio/you-win.wav' });
  audio.win(); const loading = audio.voiceLoading;
  t.mock.timers.tick(5000); await loading;
  assert.equal(c.sources.length, 0);
  assert.equal(audio.horns.size, 8);
  assert.equal(audio.voiceLoading, null, 'a later interaction can retry the recording');
  audio.dispose();
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
