// ============================================================
// input.js — global keyboard shortcuts
// ============================================================

export class Input {
  constructor(cb) {
    this.cb = cb;
    window.addEventListener('keydown', e => this.onKey(e));
  }

  onKey(e) {
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

    if (e.key === 'Escape') { this.cb.esc(); return; }
    if (typing) return; // sliders own the rest of the keys

    const k = e.key;

    if (k >= '0' && k <= '9') { this.cb.debug(parseInt(k, 10)); return; }
    if (k === 'q' || k === 'Q') return this.cb.preset(0);
    if (k === 'w' || k === 'W') return this.cb.preset(1);
    if (k === 'e' || k === 'E') return this.cb.preset(2);
    if (k === 'r' || k === 'R') { e.shiftKey ? this.cb.reset() : this.cb.preset(3); return; }
    if (k === 'p' || k === 'P') return this.cb.cyclePreset();

    switch (k) {
      case ' ':        e.preventDefault(); this.cb.pause(); break;
      case ',':        this.cb.slower(); break;
      case '.':        this.cb.faster(); break;
      case 'c': case 'C': this.cb.cinema(); break;
      case 'm': case 'M': this.cb.music(); break;
      case 'h': case 'H': this.cb.hud(); break;
      case 'g': case 'G': this.cb.panel(); break;
      case 'f': case 'F': this.cb.fullscreen(); break;
      case 's': case 'S': this.cb.shot(); break;
      case '?':        this.cb.help(); break;
      default: break;
    }
  }
}
