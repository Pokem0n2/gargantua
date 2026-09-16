// ============================================================
// audio.js — optional ambient drone (generated WAV, looped,
// routed through WebAudio for click-free fades)
// ============================================================

export class Ambient {
  constructor() {
    this.el = null;
    this.ctx = null;
    this.gain = null;
    this.playing = false;
    this.fadeTimer = null;
  }

  _init() {
    this.el = new Audio('./audio/ambient.wav');
    this.el.loop = true;
    this.el.preload = 'auto';
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = this.ctx.createMediaElementSource(this.el);
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
    src.connect(this.gain);
    this.gain.connect(this.ctx.destination);
  }

  async toggle() {
    try {
      if (!this.el) this._init();
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      if (this.playing) {
        this.gain.gain.cancelScheduledValues(this.ctx.currentTime);
        this.gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.25);
        clearTimeout(this.fadeTimer);
        this.fadeTimer = setTimeout(() => this.el.pause(), 1200);
        this.playing = false;
      } else {
        clearTimeout(this.fadeTimer);
        await this.el.play();
        this.gain.gain.cancelScheduledValues(this.ctx.currentTime);
        this.gain.gain.setTargetAtTime(0.5, this.ctx.currentTime, 0.8);
        this.playing = true;
      }
    } catch (e) {
      // autoplay refused or decode failure — stay silent, no error spam
      this.playing = false;
    }
    return this.playing;
  }
}
