/** Small synthesized sounds: no downloads, autoplay, or persistent audio graph. */
export class GameAudio {
  constructor(enabled = true) { this.enabled = enabled; this.context = null; this.noise = null; }
  setEnabled(enabled) { this.enabled = Boolean(enabled); }
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
    const duration = 0.34;
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
    filter.frequency.exponentialRampToValueAtTime(3300, now + 0.09);
    filter.frequency.exponentialRampToValueAtTime(400, now + duration);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.19, now + 0.045);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter).connect(gain).connect(context.destination);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    source.start(now); source.stop(now + duration + 0.02);
  }
  _tone(context, frequency, offset, duration, volume = 0.055) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime + offset;
    oscillator.type = 'sine'; oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(now); oscillator.stop(now + duration + 0.02);
  }
  blocked() { const c = this._context(); if (c) this._tone(c, 145, 0, 0.14, 0.06); }
  win() {
    const c = this._context();
    if (!c) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((frequency, i) => this._tone(c, frequency, i * 0.09, 0.35));
  }
  dispose() { this.context?.close().catch(() => {}); this.context = null; this.noise = null; }
}
