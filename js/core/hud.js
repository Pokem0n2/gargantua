// ============================================================
// hud.js — parameter panel, stats readout, toasts, buttons
// ============================================================

import { PARAM_DEFS } from './params.js';

export const DEBUG_VIEW_NAMES = [
  'BEAUTY', 'RAY STEPS', 'DISK ONLY', 'SKY ONLY', 'DEFLECTION',
  'DOPPLER', 'GRAV SHIFT', 'DISK TEMP', 'TURBULENCE', 'BLOOM',
];

const $ = id => document.getElementById(id);

export class Hud {
  constructor(store, cb) {
    this.store = store;
    this.cb = cb;
    this.toastTimer = null;
    this.buildPanel();
    this.wireButtons();

    this.store.onChange((id, v) => {
      if (id === '*') { this.refreshAll(); return; }
      const row = this.rows[id];
      if (row) {
        row.slider.value = v;
        row.out.textContent = row.def.fmt(v);
      }
    });
  }

  buildPanel() {
    this.rows = {};
    const groups = { disk: $('grpDisk'), cosmos: $('grpCosmos'), post: $('grpPost') };
    for (const def of PARAM_DEFS) {
      const wrap = document.createElement('div');
      wrap.className = 'param';
      const top = document.createElement('div');
      top.className = 'param-top';
      const label = document.createElement('label');
      label.textContent = def.label;
      label.htmlFor = `pr-${def.id}`;
      const out = document.createElement('output');
      out.textContent = def.fmt(this.store.values[def.id]);
      top.append(label, out);
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.id = `pr-${def.id}`;
      slider.min = def.min; slider.max = def.max; slider.step = def.step;
      slider.value = this.store.values[def.id];
      slider.dataset.pid = def.id;
      slider.addEventListener('input', () => this.store.set(def.id, parseFloat(slider.value)));
      wrap.append(top, slider);
      groups[def.group].appendChild(wrap);
      this.rows[def.id] = { slider, out, def };
    }
  }

  refreshAll() {
    for (const id in this.rows) {
      const { slider, out, def } = this.rows[id];
      slider.value = this.store.values[id];
      out.textContent = def.fmt(this.store.values[id]);
    }
  }

  wireButtons() {
    document.querySelectorAll('.pk[data-preset]').forEach(btn => {
      btn.addEventListener('click', () => this.cb.preset(parseInt(btn.dataset.preset, 10)));
    });
    $('btnCine').addEventListener('click', () => this.cb.cinema());
    $('btnSound').addEventListener('click', () => this.cb.music());
    $('btnPanel').addEventListener('click', () => this.cb.panel());
    $('btnHelp').addEventListener('click', () => this.cb.help());
    $('panelClose').addEventListener('click', () => this.cb.panel());
    $('helpClose').addEventListener('click', () => this.cb.help());
    $('btnReset').addEventListener('click', () => this.cb.reset());
    $('btnShot').addEventListener('click', () => this.cb.shot());
    document.querySelectorAll('#qbtns button').forEach(btn => {
      btn.addEventListener('click', () => this.cb.onQuality(btn.dataset.q));
    });
  }

  // ---- state reflectors ----

  setQuality(key) {
    document.querySelectorAll('#qbtns button').forEach(b =>
      b.classList.toggle('on', b.dataset.q === key));
    $('stQuality').textContent = key.toUpperCase();
  }

  setPresetActive(i) {
    document.querySelectorAll('.pk[data-preset]').forEach(b =>
      b.classList.toggle('on', parseInt(b.dataset.preset, 10) === i));
  }

  clearPresetActive() {
    document.querySelectorAll('.pk[data-preset]').forEach(b => b.classList.remove('on'));
  }

  setCinema(on) { $('btnCine').classList.toggle('on', on); }
  setSound(on) { $('btnSound').classList.toggle('on', on); }
  setPanel(open) { $('panel').hidden = !open; $('btnPanel').classList.toggle('on', open); }
  setHelp(open) { $('help').hidden = !open; }

  stats({ fps, res, steps, view }) {
    $('stFps').textContent = fps.toFixed(0);
    $('stRes').textContent = res;
    $('stSteps').textContent = steps;
    $('stView').textContent = view;
  }

  toast(msg, ms = 1600) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  hudVisible(v) { $('hud').hidden = !v; }
}
