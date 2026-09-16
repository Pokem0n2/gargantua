// ============================================================
// params.js — the 21 tunable field parameters + persistence
// ============================================================

export const PARAM_DEFS = [
  // ---- ACCRETION DISK (11) ----
  { id: 'diskInner',   group: 'disk',  label: 'DISK INNER R (Rs)',  min: 1.20, max: 4.50, step: 0.01, def: 3.00, fmt: v => v.toFixed(2) },
  { id: 'diskOuter',   group: 'disk',  label: 'DISK OUTER R (Rs)',  min: 4.0,  max: 16.0, step: 0.1,  def: 11.0, fmt: v => v.toFixed(1) },
  { id: 'diskBright',  group: 'disk',  label: 'DISK BRIGHTNESS',    min: 0.0,  max: 6.0,  step: 0.01, def: 1.40, fmt: v => v.toFixed(2) },
  { id: 'diskTemp',    group: 'disk',  label: 'PEAK TEMP (K)',      min: 3000, max: 15000,step: 25,  def: 6600, fmt: v => v.toFixed(0) },
  { id: 'tempExp',     group: 'disk',  label: 'TEMP GRADIENT p',    min: 0.50, max: 1.00, step: 0.005,def: 0.75, fmt: v => v.toFixed(3) },
  { id: 'beamExp',     group: 'disk',  label: 'DOPPLER BEAMING γ',  min: 0.0,  max: 4.0,  step: 0.05, def: 2.40, fmt: v => v.toFixed(2) },
  { id: 'gravShift',   group: 'disk',  label: 'GRAV REDSHIFT',      min: 0.0,  max: 1.0,  step: 0.01, def: 1.00, fmt: v => v.toFixed(2) },
  { id: 'diskDensity', group: 'disk',  label: 'DISK DENSITY',       min: 0.0,  max: 2.0,  step: 0.01, def: 1.00, fmt: v => v.toFixed(2) },
  { id: 'turbAmp',     group: 'disk',  label: 'TURBULENCE',         min: 0.0,  max: 1.0,  step: 0.01, def: 0.70, fmt: v => v.toFixed(2) },
  { id: 'turbScale',   group: 'disk',  label: 'TURBULENCE SCALE',   min: 0.3,  max: 3.0,  step: 0.01, def: 1.20, fmt: v => v.toFixed(2) },
  { id: 'orbitSpeed',  group: 'disk',  label: 'ORBITAL SPEED ×',    min: 0.0,  max: 3.0,  step: 0.01, def: 1.00, fmt: v => v.toFixed(2) },
  // ---- COSMOS (4) ----
  { id: 'starDensity', group: 'cosmos',label: 'STAR DENSITY',       min: 0.0,  max: 2.0,  step: 0.01, def: 1.00, fmt: v => v.toFixed(2) },
  { id: 'starBright',  group: 'cosmos',label: 'STAR BRIGHTNESS',    min: 0.0,  max: 3.0,  step: 0.01, def: 1.20, fmt: v => v.toFixed(2) },
  { id: 'mwIntensity', group: 'cosmos',label: 'MILKY WAY GLOW',     min: 0.0,  max: 2.0,  step: 0.01, def: 0.90, fmt: v => v.toFixed(2) },
  { id: 'skyRotate',   group: 'cosmos',label: 'SKY DRIFT',          min: 0.0,  max: 0.02, step: 0.0001, def: 0.003, fmt: v => v.toFixed(4) },
  // ---- OPTICS / POST (6) ----
  { id: 'bloomStrength',group: 'post', label: 'BLOOM STRENGTH',     min: 0.0,  max: 2.5,  step: 0.01, def: 1.00, fmt: v => v.toFixed(2) },
  { id: 'bloomThresh', group: 'post',  label: 'BLOOM THRESHOLD',    min: 0.0,  max: 3.0,  step: 0.01, def: 0.80, fmt: v => v.toFixed(2) },
  { id: 'bloomRadius', group: 'post',  label: 'BLOOM RADIUS',       min: 0.2,  max: 3.0,  step: 0.01, def: 1.10, fmt: v => v.toFixed(2) },
  { id: 'exposure',    group: 'post',  label: 'EXPOSURE',           min: 0.2,  max: 3.0,  step: 0.01, def: 1.05, fmt: v => v.toFixed(2) },
  { id: 'grain',       group: 'post',  label: 'FILM GRAIN',         min: 0.0,  max: 0.2,  step: 0.001,def: 0.045,fmt: v => v.toFixed(3) },
  { id: 'chroma',      group: 'post',  label: 'DISPERSION (CA)',    min: 0.0,  max: 0.006,step: 0.00005, def: 0.0018, fmt: v => v.toFixed(5) },
];

const STORE_KEY = 'gargantua.params.v1';
const listeners = new Set();

export class ParamStore {
  constructor() {
    this.values = {};
    this.load();
  }

  load() {
    for (const d of PARAM_DEFS) this.values[d.id] = d.def;
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        for (const d of PARAM_DEFS) {
          if (d.id in saved) {
            const v = Number(saved[d.id]);
            if (Number.isFinite(v)) this.values[d.id] = Math.min(d.max, Math.max(d.min, v));
          }
        }
      }
    } catch (e) { /* private mode / corrupted — defaults are fine */ }
  }

  save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.values)); } catch (e) {}
  }

  set(id, v) {
    const d = PARAM_DEFS.find(p => p.id === id);
    if (!d) return;
    v = Math.min(d.max, Math.max(d.min, Number(v)));
    if (!Number.isFinite(v) || v === this.values[id]) return;
    this.values[id] = v;
    this.save();
    listeners.forEach(fn => fn(id, v));
  }

  reset() {
    for (const d of PARAM_DEFS) this.values[d.id] = d.def;
    this.save();
    listeners.forEach(fn => fn('*', this.values));
  }

  onChange(fn) { listeners.add(fn); }
}

export function createParamStore() { return new ParamStore(); }
