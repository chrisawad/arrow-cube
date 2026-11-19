/** Local sound effects, with an optional bundled recording for the win voice. */
export class GameAudio {
  constructor(enabled = true, { winVoiceURL = null, winVoiceEnabled = false } = {}) {
    this.enabled = enabled; this.context = null; this.noise = null; this.tick = null; this.horns = new Set();
    this.winVoiceURL = winVoiceURL; this.winVoiceEnabled = winVoiceEnabled === true; this.voiceBuffer = null; this.voiceLoading = null; this.voicePlayback = null; this.winSequence = 0;
  }
  setEnabled(enabled) { this.enabled = Boolean(enabled); if (!this.enabled) this.stopWin(); }
  setWinVoiceEnabled(enabled) { this.winVoiceEnabled = Boolean(enabled); if (!this.winVoiceEnabled) this._stopVoice(); }
  // Unlock audio during the click, without playing a sound before impact.
  prepare() { const context = this._context(); if (context && this.winVoiceEnabled) this._loadVoice(context); }
  _loadVoice(context) {
    if (!this.winVoiceURL) return Promise.resolve(null);
    if (this.voiceBuffer) return Promise.resolve(this.voiceBuffer);
    if (this.voiceLoading) return this.voiceLoading;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const loading = fetch(this.winVoiceURL, { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error('Win voice unavailable'); return response.arrayBuffer(); })
      .then(bytes => context.decodeAudioData(bytes))
      .then(buffer => { this.voiceBuffer = buffer; return buffer; })
      .catch(error => { console.warn('Win voice could not load; the fanfare remains available.', error); return null; })
      .finally(() => { clearTimeout(timeout); if (this.voiceLoading === loading) this.voiceLoading = null; });
    this.voiceLoading = loading;
    return loading;
  }
  _playVoice(context, buffer) {
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer; gain.gain.value = .8;
    source.connect(gain).connect(context.destination);
    const playback = { source, gain }; this.voicePlayback = playback;
    source.onended = () => {
      source.disconnect(); gain.disconnect();
      if (this.voicePlayback === playback) this.voicePlayback = null;
    };
    source.start(context.currentTime);
    return buffer.duration + .12;
  }
  _context() {
    if (!this.enabled) return null;
    try {
      const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContext) return null;
      if (!this.context || this.context.state === 'closed') this.context = new AudioContext();
      if (this.context.state === 'suspended') this.context.resume().catch(() => {});
      return this.context;
    } catch { return null; }
  }
  swoosh() {
    const context = this._context();
    if (!context) return;
    const duration = 0.22;
    if (!this.noise || this.noise.sampleRate !== context.sampleRate) {
      this.noise = context.createBuffer(1, Math.ceil(context.sampleRate * 0.5), context.sampleRate);
      const values = this.noise.getChannelData(0);
      for (let i = 0; i < values.length; i++) values[i] = Math.random() * 2 - 1;
    }
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    const now = context.currentTime;
    source.buffer = this.noise;
    filter.type = 'bandpass'; filter.Q.value = 0.5;
    filter.frequency.setValueAtTime(850, now);
    filter.frequency.exponentialRampToValueAtTime(3300, now + 0.065);
    filter.frequency.exponentialRampToValueAtTime(400, now + duration);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.19, now + 0.035);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter).connect(gain).connect(context.destination);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    source.start(now); source.stop(now + duration + 0.02);
  }
  _trumpet(context, wave, frequency, offset, duration, volume) {
    const oscillator = context.createOscillator(), filter = context.createBiquadFilter(), gain = context.createGain();
    const vibrato = context.createOscillator(), depth = context.createGain();
    const now = context.currentTime + offset;
    oscillator.setPeriodicWave(wave);
    oscillator.frequency.setValueAtTime(frequency * .994, now);
    oscillator.frequency.linearRampToValueAtTime(frequency, now + .025);
    filter.type = 'lowpass'; filter.Q.value = .7;
    // A brass attack opens the upper harmonics, then softens into the held note.
    filter.frequency.setValueAtTime(frequency * 2, now);
    filter.frequency.exponentialRampToValueAtTime(frequency * 9, now + .025);
    filter.frequency.exponentialRampToValueAtTime(frequency * 4, now + duration);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + .012);
    gain.gain.linearRampToValueAtTime(volume * .7, now + .065);
    gain.gain.setValueAtTime(volume * .65, now + duration - .045);
    gain.gain.linearRampToValueAtTime(0, now + duration);
    vibrato.frequency.value = 5.4;
    depth.gain.setValueAtTime(0, now);
    depth.gain.linearRampToValueAtTime(frequency * .004, now + Math.min(.25, duration * .8));
    vibrato.connect(depth).connect(oscillator.frequency);
    oscillator.connect(filter).connect(gain).connect(context.destination);
    const horn = { oscillator, vibrato, gain, nodes: [oscillator, vibrato, depth, filter, gain] };
    this.horns.add(horn);
    oscillator.onended = () => { for (const node of horn.nodes) node.disconnect(); this.horns.delete(horn); };
    oscillator.start(now); vibrato.start(now);
    oscillator.stop(now + duration + .01); vibrato.stop(now + duration + .01);
  }
  blocked() {
    const context = this._context();
    if (!context) return;
    // A dry, sharp impact: a tiny noise transient plus a rapidly damped high
    // tone. Baking the envelope into the buffer keeps each collision to 55 ms.
    if (!this.tick || this.tick.sampleRate !== context.sampleRate) {
      this.tick = context.createBuffer(1, Math.ceil(context.sampleRate * 0.055), context.sampleRate);
      const values = this.tick.getChannelData(0);
      for (let i = 0; i < values.length; i++) {
        const t = i / context.sampleRate;
        const envelope = Math.min(1, t / 0.0008) * Math.exp(-t * 115);
        const tone = Math.sin(2 * Math.PI * (2100 * t - 6500 * t * t));
        const transient = (Math.random() * 2 - 1) * Math.exp(-t * 240);
        values[i] = envelope * (tone * 0.65 + transient * 0.35);
      }
    }
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = this.tick;
    gain.gain.value = 0.28;
    source.connect(gain).connect(context.destination);
    source.onended = () => { source.disconnect(); gain.disconnect(); };
    source.start(context.currentTime);
  }
  win() {
    const c = this._context();
    if (!c) return;
    this.stopWin();
    const sequence = this.winSequence;
    const play = buffer => {
      if (!this.enabled || sequence !== this.winSequence || c !== this.context) return;
      const delay = this.winVoiceEnabled && buffer ? this._playVoice(c, buffer) : 0;
      this._fanfare(c, delay);
    };
    if (!this.winVoiceEnabled) play(null);
    else if (this.voiceBuffer) play(this.voiceBuffer);
    else if (this.winVoiceURL) this._loadVoice(c).then(play);
    else play(null);
  }
  _fanfare(c, delay) {
    const harmonics = new Float32Array([0, 1, .8, .55, .4, .25, .18, .12, .09, .07, .05, .04]);
    const wave = c.createPeriodicWave(new Float32Array(harmonics.length), harmonics);
    // A short G-G-G / C-E-G trumpet fanfare, ending on a bright C-major chord.
    for (const [frequency, at, length] of [[392, 0, .14], [392, .18, .14], [392, .36, .14],
      [523.25, .57, .2], [659.25, .82, .2], [783.99, 1.07, .85]]) {
      this._trumpet(c, wave, frequency, at + delay, length, .07);
    }
    for (const frequency of [523.25, 659.25]) this._trumpet(c, wave, frequency, 1.07 + delay, .85, .018);
  }
  _stopVoice() {
    if (this.voicePlayback) {
      const { source, gain } = this.voicePlayback;
      try { source.stop(); } catch { /* Already ended. */ }
      source.disconnect(); gain.disconnect(); this.voicePlayback = null;
    }
  }
  stopWin() {
    this.winSequence++;
    this._stopVoice();
    for (const horn of this.horns) {
      horn.gain.gain.cancelScheduledValues(0); horn.gain.gain.value = 0;
      try { horn.oscillator.stop(); horn.vibrato.stop(); } catch { /* Already ended. */ }
      for (const node of horn.nodes) node.disconnect();
    }
    this.horns.clear();
  }
  dispose() { this.stopWin(); this.context?.close().catch(() => {}); this.context = null; this.noise = null; this.tick = null; }
}
