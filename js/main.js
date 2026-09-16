// ============================================================
// main.js — GARGANTUA application shell
// boot, main loop, state, URL automation interface, public API
// ============================================================

import * as THREE from 'three';
import { createParamStore } from './core/params.js';
import { Pipeline, QUALITY_PRESETS } from './core/scene.js';
import { CameraRig, VIEW_PRESETS } from './core/camera.js';
import { Hud, DEBUG_VIEW_NAMES } from './core/hud.js';
import { Input } from './core/input.js';
import { Ambient } from './core/audio.js';
import {
  probeWebGL, showFatal, hideFatal, wireRecovery, bootMessage, dismissBoot,
} from './core/recovery.js';

// ---------------- url / environment ----------------

// console-error collector for automated verification (window.__CONSOLE_ERRORS)
window.__CONSOLE_ERRORS = [];
{
  console.error = ((orig) => (...args) => {
    try {
      const msg = args.map(a => (a && a.message) ? a.message : String(a)).join(' ');
      window.__CONSOLE_ERRORS.push(msg.slice(0, 300));
    } catch (e) {}
    orig(...args);
  })(console.error);
  window.addEventListener('error', e => window.__CONSOLE_ERRORS.push(`[error] ${e.message || 'unknown'}`));
  window.addEventListener('unhandledrejection', e => window.__CONSOLE_ERRORS.push(`[rejection] ${e.reason || 'unknown'}`));
}

const url = new URLSearchParams(location.search);
const ustr = (k, d) => (url.has(k) ? url.get(k) : d);
const unum = (k, d) => (url.has(k) && Number.isFinite(parseFloat(url.get(k))) ? parseFloat(url.get(k)) : d);

const IS_MOBILE = (matchMedia('(pointer: coarse)').matches &&
                   Math.min(screen.width, screen.height) < 920) ||
                  /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);

const STATE_KEY = 'gargantua.state.v1';

// ---------------- persistent app state ----------------

const state = {
  quality: IS_MOBILE ? 'standard' : 'high',
  preset: 0,
  hudVisible: true,
  panelOpen: false,
  simTime: unum('t', 0),
  realTime: 0,
  skyAngle: 0,
  timeSpeed: 1,
  paused: false,
  debug: Math.max(0, Math.min(9, Math.round(unum('debug', 0)))),
  cinema: url.get('cinematic') === '1',
};

try {
  const raw = localStorage.getItem(STATE_KEY);
  if (raw) {
    const s = JSON.parse(raw);
    if (s.quality in QUALITY_PRESETS) state.quality = s.quality;
    if (typeof s.hudVisible === 'boolean') state.hudVisible = s.hudVisible;
    if (typeof s.preset === 'number') state.preset = Math.max(0, Math.min(3, s.preset | 0));
  }
} catch (e) {}
if (ustr('quality', '') in QUALITY_PRESETS) state.quality = ustr('quality', '');

function persistState() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({
      quality: state.quality,
      hudVisible: state.hudVisible,
      preset: state.preset,
    }));
  } catch (e) {}
}

// ---------------- globals ----------------

const canvas = document.getElementById('view');
let pipeline = null;
let rig = null;
let hud = null;
let ambient = null;
let contextLost = false;

const params = createParamStore();

const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 300);
const worldUp = new THREE.Vector3(0, 1, 0);
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3();
const _m3 = new THREE.Matrix3();

let lastNow = performance.now();
let fpsEMA = 60;
let statClock = 0;

// ---------------- camera basis ----------------

function updateCameraUniforms() {
  _f.set(0, 0, 0).sub(camera.position).normalize();      // forward (target = origin)
  _r.crossVectors(_f, worldUp);
  if (_r.lengthSq() < 1e-6) _r.set(1, 0, 0);             // looking straight down
  _r.normalize();
  _u.crossVectors(_r, _f);
  _m3.set(_r.x, _u.x, _f.x,
          _r.y, _u.y, _f.y,
          _r.z, _u.z, _f.z);
  pipeline.setCamera(camera.position, _m3, camera.fov);
}

// ---------------- one rendered frame ----------------

function drawFrame(advance = false, dt = 0) {
  if (advance && !state.paused) {
    state.simTime += dt * state.timeSpeed;
    state.skyAngle += dt * state.timeSpeed * params.values.skyRotate;
  }
  rig.update(dt);
  updateCameraUniforms();
  pipeline.setFrame(state.simTime, state.realTime, state.skyAngle, state.debug);
  pipeline.renderFrame();
}

// ---------------- screenshot ----------------

function capture(name) {
  const file = name || `gargantua-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`;
  drawFrame(false, 0); // fresh synchronous frame so toBlob sees pixels
  pipeline.renderer.domElement.toBlob(blob => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = file.endsWith('.png') ? file : file + '.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 8000);
    document.title = 'GARGANTUA · SHOT SAVED';
    hud.toast('SCREENSHOT SAVED');
  }, 'image/png');
}

// ---------------- ui callbacks ----------------

const cb = {
  preset(i) {
    state.preset = i;
    const name = rig.preset(i);
    hud.setPresetActive(i);
    hud.toast(`VIEW · ${name}`);
    persistState();
  },
  cyclePreset() { cb.preset((state.preset + 1) % VIEW_PRESETS.length); },
  cinema() {
    state.cinema = !state.cinema;
    if (state.cinema) { rig.startCinematic(); hud.toast('CINEMATIC LOOP · ON'); }
    else { rig.stopCinematic(); hud.toast('CINEMATIC LOOP · OFF'); }
    hud.setCinema(state.cinema);
  },
  async music() {
    const on = await ambient.toggle();
    hud.setSound(on);
    hud.toast(on ? 'AMBIENT · ON' : 'AMBIENT · OFF');
  },
  panel() {
    state.panelOpen = !state.panelOpen;
    hud.setPanel(state.panelOpen);
    persistState();
  },
  help() { hud.setHelp($id('help').hidden); },
  hud() {
    state.hudVisible = !state.hudVisible;
    hud.hudVisible(state.hudVisible);
    persistState();
  },
  fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  },
  shot() { capture(); },
  reset() {
    params.reset();
    hud.toast('PARAMETERS RESET');
  },
  pause() {
    state.paused = !state.paused;
    hud.toast(state.paused ? 'TIME · PAUSED' : 'TIME · FLOWING');
  },
  slower() { state.timeSpeed = Math.max(0.05, state.timeSpeed * 0.5); hud.toast(`TIME × ${state.timeSpeed.toFixed(2)}`); },
  faster() { state.timeSpeed = Math.min(8, state.timeSpeed * 2); hud.toast(`TIME × ${state.timeSpeed.toFixed(2)}`); },
  debug(i) {
    state.debug = i;
    hud.toast(`VIEW ${i} · ${DEBUG_VIEW_NAMES[i]}`);
    statFlush();
  },
  esc() {
    if (!$id('help').hidden) { hud.setHelp(false); return; }
    if (state.cinema) { cb.cinema(); return; }
    if (state.panelOpen) { cb.panel(); return; }
  },
  onQuality(q) {
    if (!(q in QUALITY_PRESETS) || q === state.quality) return;
    state.quality = q;
    applyQuality();
    persistState();
    hud.toast(`QUALITY · ${QUALITY_PRESETS[q].label}`);
  },
  onGrab() { // user grabbed orbit while cinematic
    if (state.cinema) { state.cinema = false; hud.setCinema(false); }
    hud.clearPresetActive();
  },
};

const $id = id => document.getElementById(id);

// ---------------- quality / resize ----------------

function applyQuality() {
  const scaleMul = Math.max(0.2, Math.min(1, unum('scale', 1)));
  pipeline.setQuality(state.quality, scaleMul);
  hud.setQuality(state.quality);
  resize();
  statFlush();
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  pipeline.resize(w, h);
}

function statFlush() {
  const { w, h, quality } = pipeline.renderSize;
  hud.stats({
    fps: fpsEMA,
    res: `${w}×${h}`,
    steps: String(pipeline.bhUniforms.uSteps.value),
    quality,
    view: DEBUG_VIEW_NAMES[state.debug],
  });
}

// ---------------- boot ----------------

function boot() {
  const probe = probeWebGL();
  if (!probe.ok) {
    showFatal('WebGL is not available in this browser.',
              'Enable hardware acceleration or update your GPU driver, then reload.');
    return;
  }

  bootMessage('LINKING THREE R160 · OK');
  bootMessage('BUILDING SPACETIME PIPELINE…');

  try {
    pipeline = new Pipeline(canvas);
  } catch (e) {
    showFatal('Renderer construction failed: ' + (e.message || e),
              'Try SAFE MODE (LOW) below.');
    return;
  }

  pipeline.renderer.debug.onShaderError = (gl, prog, vs, fs) => {
    showFatal('Spacetime shader failed to compile.',
              'Your GPU/driver rejected the integrator. Try SAFE MODE (LOW).');
  };

  rig = new CameraRig(camera, canvas, cb.onGrab);
  hud = new Hud(params, cb);
  ambient = new Ambient();
  new Input(cb);

  wireRecovery({
    onContextLost() {
      contextLost = true;
      bootMessage('GPU CONTEXT LOST — RECOVERING…');
      $id('boot').hidden = false;
    },
    onContextRestored() {
      try {
        pipeline.buildTargets();          // re-create render targets
        resize();
        contextLost = false;
        $id('boot').hidden = true;
        hud.toast('GPU CONTEXT RESTORED');
      } catch (e) {
        showFatal('Context recovery failed: ' + (e.message || e), 'Reload the page.');
      }
    },
  });

  params.onChange((id, v) => { pipeline.syncParams(params.values); });

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 250));

  applyQuality();
  pipeline.syncParams(params.values);

  // HUD initial state
  hud.hudVisible(state.hudVisible);
  hud.setPanel(state.panelOpen);
  hud.setCinema(state.cinema);
  hud.setPresetActive(state.preset);

  // initial camera: restore last preset, honor ?preset=
  const presetOverride = url.has('preset') ? Math.max(0, Math.min(3, parseInt(url.get('preset'), 10) || 0)) : state.preset;
  rig.preset(presetOverride, true);
  state.preset = presetOverride;
  hud.setPresetActive(presetOverride);
  if (state.cinema) rig.startCinematic();

  // URL per-param overrides (?diskBright=2.5 etc.) — session only
  for (const [k, v] of url.entries()) {
    if (Object.prototype.hasOwnProperty.call(params.values, k) && Number.isFinite(parseFloat(v))) {
      params.set(k, parseFloat(v));
    }
  }

  // frame the first view immediately
  rig.update(0);
  updateCameraUniforms();
  pipeline.setFrame(state.simTime, state.realTime, state.skyAngle, state.debug);
  pipeline.renderFrame();

  dismissBoot();
  if (IS_MOBILE) hud.toast('MOBILE · STANDARD QUALITY', 2600);

  // URL screenshot automation
  if (url.has('shot')) {
    const delay = Math.max(0, unum('delay', 1600));
    const name = ustr('name', `gargantua-auto-${Date.now()}.png`);
    const W = unum('width', 0), H = unum('height', 0);
    if (W > 0 && H > 0) {
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      pipeline.resize(W, H);
    }
    if (url.get('freeze') === '1') state.paused = true;
    setTimeout(() => capture(name), delay);
  }

  // public automation API
  window.GARGANTUA = {
    version: '1.0.0',
    params: params.values,
    setParam(id, v) { params.set(id, Number(v)); return params.values[id]; },
    resetParams() { params.reset(); },
    setQuality(q) { cb.onQuality(q); },
    setPreset(i) { cb.preset(i); },
    setDebug(i) { cb.debug(i); },
    cinematic(onOff) { if (state.cinema !== !!onOff) cb.cinema(); return state.cinema; },
    pause(onOff) { if (state.paused !== !!onOff) cb.pause(); return state.paused; },
    setParamURL: (id, v) => url.set(id, String(v)),
    screenshot: capture,
    stats() {
      const { w, h } = pipeline.renderSize;
      return {
        fps: Math.round(fpsEMA), w, h, steps: pipeline.bhUniforms.uSteps.value,
        quality: state.quality, debug: state.debug, paused: state.paused,
        simTime: state.simTime, mobile: IS_MOBILE, hdr: pipeline.hdr,
        webgl2: pipeline.isWebGL2, contextLost,
      };
    },
  };

  window.addEventListener('keydown', e => { if (e.key === '?') e.preventDefault(); }, { capture: true });

  requestAnimationFrame(loop);
}

// ---------------- main loop ----------------

function loop(now) {
  requestAnimationFrame(loop);
  if (contextLost) { lastNow = now; return; }

  const dt = Math.min((now - lastNow) / 1000, 0.1);
  lastNow = now;
  state.realTime += dt;

  drawFrame(true, dt);

  if (dt > 1e-5) fpsEMA = fpsEMA * 0.92 + (1 / dt) * 0.08;
  statClock += dt;
  if (statClock > 0.25) { statClock = 0; statFlush(); }
}

hideFatal();
boot();
