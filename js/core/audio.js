// ============================================================
// audio.js — optional ambient drone (generated WAV, looped)
// Plain HTMLAudioElement playback with programmatic fades: works
// on http(s), file:// and data: sources alike. WebAudio routing is
// deliberately avoided — on opaque origins (file://) a
// MediaElementSource is treated as cross-origin and goes silent.
// ============================================================

export class Ambient {
  constructor() {
    this.el = null;
    this.playing = false;
    this.fadeTimer = null;
    this.target = 0.5;
    this.lastError = null;
  }

  _init() {
    // In the single-file build, three.js shadows the global `Audio` with
    // THREE.Audio — use the native constructor captured by tools/build.py.
    const Ctor = window.__NATIVE_AUDIO_CTOR || Audio;
    this.el = new Ctor('./audio/ambient.wav');
    this.el.loop = true;
    this.el.preload = 'auto';
    this.el.volume = 0;
  }

  _fade(to, ms) {
    clearInterval(this.fadeTimer);
    const from = this.el.volume;
    const t0 = performance.now();
    this.fadeTimer = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      this.el.volume = Math.max(0, Math.min(1, from + (to - from) * k));
      if (k >= 1) clearInterval(this.fadeTimer);
    }, 40);
  }

  async toggle() {
    try {
      if (!this.el) this._init();
      if (this.playing) {
        this._fade(0, 500);
        clearTimeout(this.fadeTimer);
        this.fadeTimer = setTimeout(() => this.el.pause(), 600);
        this.playing = false;
      } else {
        clearTimeout(this.fadeTimer);
        await this.el.play();
        this._fade(this.target, 900);
        this.playing = true;
      }
    } catch (e) {
      this.playing = false;
      this.lastError = (e && (e.name + ': ' + e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 3).join(' | '))) || String(e);
    }
    return this.playing;
  }
}
