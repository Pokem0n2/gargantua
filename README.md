# GARGANTUA — Schwarzschild Black Hole Raytracer

A fully procedural, real-time **Schwarzschild null-geodesic raytracer** running in a single
fullscreen fragment shader. No black sphere, no painted ring, no textures, no video —
every pixel is produced by numerically integrating the photon equation of motion in
curved spacetime, ~200–500 velocity-Verlet steps per pixel, per frame.

```
d²x/dλ² = −(3/2) · h² · x / |x|⁵        (G = c = 1, r_s = 1, M = 1/2)
```

equivalent to the Binet form `d²u/dφ² = −u + (3/2) r_s u²`. The shadow, photon ring,
Einstein arcs, multiple disk images and full gravitational lensing are **emergent**.

## Run

**Offline / double-click:** open `gargantua.html` in any modern browser — no server,
no internet needed. The file is fully self-contained (Three.js, shaders, styles and
all code inlined; `audio/ambient.wav` is picked up from the folder next to it).

**From a local server (development):**

```bash
cd gargantua
py tools/build.py                    # rebuild gargantua.html from js/ sources
py tools/serve.py 8080               # no-cache static server
# then open http://localhost:8080/gargantua.html
```

- Source of truth is the ES-module tree in `js/**` + `tools/template.html` (HUD DOM);
  `tools/build.py` inlines everything into one classic-scope bundle and auto-deconflicts
  names against Three.js (e.g. three's `Audio` class vs the DOM `Audio` constructor).
- Three.js r160 is vendored locally (`vendor/`), so it runs fully offline.

## Controls

| Keys | Action |
|---|---|
| drag / wheel | orbit / zoom (OrbitControls) |
| `Q` `W` `E` `R` | view presets I–IV (Equator · Zenith · Perihelion · Deep Field) |
| `P` | cycle presets |
| `C` | cinematic camera loop |
| `0`–`9` | debug views: 0 beauty, 1 ray-steps, 2 disk only, 3 sky only, 4 deflection, 5 Doppler, 6 grav-shift, 7 disk temp, 8 turbulence, 9 bloom buffer |
| `SPACE` / `,` / `.` | pause / slower / faster |
| `M` | ambient drone music (generated WAV, looped) |
| `H` / `G` / `?` | toggle HUD / parameter panel / help |
| `S` | save PNG |
| `F` | fullscreen |
| `Shift+R` / `ESC` | reset parameters / close–exit cinema |

## The 21 field parameters

Panel `G` (persisted in `localStorage`):

- **Disk (11)** — inner/outer radius (Rs), brightness, peak temperature (K),
  temperature gradient *p*, Doppler beaming exponent *γ*, gravitational-redshift mix,
  disk density, turbulence amplitude, turbulence scale, orbital speed ×.
- **Cosmos (4)** — star density, star brightness, Milky-Way glow, sky drift.
- **Optics (6)** — bloom strength / threshold / radius, exposure, film grain, dispersion (CA).

## Physics on board

- Event horizon capture (r < r_s), photon sphere & photon ring (critical impact parameter),
  multiple equatorial-plane crossings per ray → upper/lower arcs + secondary images
- Thin disk (ISCO default inner edge 3 r_s) with Shakura–Sunyaev profile `T ∝ (r_in/r)^p`,
  blackbody color from the Planckian locus
- Special-relativistic Doppler beaming `I ∝ δ^γ` (approaching side brightens) and
  gravitational redshift `√(1−r_s/r)` — both independently adjustable
- Keplerian differential rotation + advected fbm turbulence → shearing hot streaks
- Procedural starfield (heavy-tailed luminances, blackbody tints) and fbm Milky Way
- Post: HDR half-float pipeline → threshold bloom (2 mips) → **ACES** → sRGB →
  vignette, film grain + dither, radial dispersion

## Quality / platforms

`STANDARD / HIGH / CINEMATIC` (internal resolution × dpr cap, integrator steps 220/340/500,
fbm octaves 4/5/6). Mobile auto-selects Standard. Retina-aware. WebGL context loss is
caught and auto-recovered; shader/startup faults show a fatal overlay with a
**SAFE MODE (LOW)** one-click fallback.

## URL automation interface

```
?shot=1&name=frame.png&delay=2000      auto-download PNG after delay (title flips to “SHOT SAVED”)
?width=1600&height=900                 force canvas size for the shot
?preset=0..3  &quality=standard|high|cinematic  &debug=0..9
?cinematic=1  &t=42 (sim time)  &freeze=1  &scale=0.4 (render scale)  &diskBright=2.5 (any param id)
```

`window.GARGANTUA` JS API: `stats()`, `setParam(id,v)`, `setPreset(i)`, `setQuality(q)`,
`setDebug(i)`, `cinematic(bool)`, `pause(bool)`, `screenshot(name)`.

## Layout

```
gargantua.html        SINGLE-FILE BUILD — the entry you open (self-contained)
css/style.css         source styles (inlined by the build)
js/main.js            boot, loop, state, URL API     (build sources)
js/core/params.js     21 parameters + persistence
js/core/scene.js      HDR pipeline, bloom, quality, resize, recovery
js/core/camera.js     OrbitControls, presets, cinematic loop
js/core/hud.js        panel/stats/toasts        js/core/input.js   shortcuts
js/core/audio.js      ambient playback          js/core/recovery.js  WebGL faults
js/shaders/blackhole.js  geodesic integrator + disk + sky (GLSL)
js/shaders/post.js       bright/blur/composite (GLSL)
tools/build.py        bundles js/ + css + template → gargantua.html
tools/template.html   HUD DOM skeleton used by the build
tools/serve.py        no-cache static dev server
tools/make_audio.py   regenerates audio/ambient.wav
vendor/               three.module.js r160, OrbitControls (local)
audio/ambient.wav     generated 48 s seamless drone
```
