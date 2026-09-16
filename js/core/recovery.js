// ============================================================
// recovery.js — WebGL capability checks, context-loss handling,
// fatal overlay, safe-mode fallback
// ============================================================

const $ = id => document.getElementById(id);

export function probeWebGL() {
  try {
    const c = document.createElement('canvas');
    const gl2 = c.getContext('webgl2');
    if (gl2) return { ok: true, webgl2: true, gl: gl2 };
    const gl1 = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (gl1) return { ok: true, webgl2: false, gl: gl1 };
  } catch (e) { /* fallthrough */ }
  return { ok: false, webgl2: false, gl: null };
}

export function showFatal(msg, hint) {
  $('boot').hidden = false;
  $('boot').classList.remove('done');
  $('fatal').hidden = false;
  $('fatalMsg').textContent = msg || 'WebGL could not be initialized.';
  if (hint) $('fatalHint').textContent = hint;
}

export function hideFatal() { $('fatal').hidden = true; }

export function safeModeAndReload() {
  try {
    localStorage.setItem('gargantua.state.v1', JSON.stringify({ quality: 'standard' }));
  } catch (e) {}
  const u = new URL(location.href);
  u.searchParams.set('quality', 'standard');
  u.searchParams.set('scale', '0.4');
  location.replace(u.toString());
}

export function wireRecovery({ onContextLost, onContextRestored }) {
  const canvas = $('view');

  $('fatalRetry').addEventListener('click', () => location.reload());
  $('fatalSafe').addEventListener('click', safeModeAndReload);

  window.addEventListener('error', e => {
    // surface script faults on the boot overlay while the scene is not yet up
    if (!window.__GARGANTUA_READY) {
      const m = $('bootMsg');
      if (m) m.textContent = 'FAULT: ' + (e.message || 'unknown').slice(0, 90);
    }
  });

  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault(); // required to allow later restore
    if (onContextLost) onContextLost(e);
  });
  canvas.addEventListener('webglcontextrestored', e => {
    if (onContextRestored) onContextRestored(e);
  });
}

export function bootMessage(t) {
  const m = $('bootMsg');
  if (m) m.textContent = t;
}

export function dismissBoot() {
  const b = $('boot');
  b.classList.add('done');
  setTimeout(() => { b.hidden = true; }, 1000);
  window.__GARGANTUA_READY = true;
}
