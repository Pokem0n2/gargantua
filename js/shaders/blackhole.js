// ============================================================
// blackhole.js — the spacetime integrator (fullscreen fragment shader)
//
// Physics: Schwarzschild metric, geometrized units G = c = 1, r_s = 1
// (therefore M = r_s / 2 = 0.5). A photon's path is obtained by
// integrating the exact null-geodesic equation in the pseudo-Cartesian
// orbital form
//
//     d²x/dλ² = -(3/2) · h² · x / |x|⁵        h = |x × dx/dλ| (conserved)
//
// which is equivalent to the Binet equation d²u/dφ² = -u + (3/2) r_s u².
// Integration: adaptive velocity-Verlet (symplectic, h² preserved).
// Everything below the photon sphere is real integration — no black
// sphere, no painted ring: the shadow, photon ring, Einstein arcs and
// every secondary image of the disk emerge from the ODE itself.
// ============================================================

export const BLACKHOLE_VERT = /* glsl */`
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const BLACKHOLE_FRAG = /* glsl */`
varying vec2 vNdc;

uniform vec2  uResolution;
uniform float uTime;         // simulation time (s)
uniform vec3  uCamPos;
uniform mat3  uCamMat;       // columns: right, up, forward
uniform float uTanFov;
uniform float uAspect;
uniform int   uSteps;        // integrator step budget
uniform int   uOct;          // fbm octave budget (quality)
uniform int   uDebug;        // 0 beauty, 1..9 debug
uniform float uEscape;       // escape radius (Rs)

// disk
uniform float uDiskInner, uDiskOuter, uDiskBright, uDiskTemp, uTempExp;
uniform float uBeamExp, uGravShift, uDiskDensity;
uniform float uTurbAmp, uTurbScale, uOrbitSpeed;

// cosmos
uniform float uStarDensity, uStarBright, uMW, uSkyAngle;

const int   MAX_STEPS = 512;
const float PI = 3.14159265359;

// ---------------- hash / noise ----------------

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}

float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = p - i;
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i);
  float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
             mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}

float fbm(vec3 p, int octaves) {
  float a = 0.5;
  float s = 0.0;
  float norm = 0.0;
  // rotate the lattice each octave so value-noise grid artifacts cancel
  mat3 R = mat3(0.36, 0.48, -0.8,
                -0.8, 0.60, 0.0,
                0.48, 0.64, 0.6);
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    s += a * vnoise(p);
    norm += a;
    p = R * p * 2.03 + vec3(13.7, 7.1, 3.9);
    a *= 0.52;
  }
  return s / max(norm, 1e-4);
}

// ---------------- blackbody chroma ----------------
// Planckian locus approximation (normalized, luminance handled apart).

vec3 blackbody(float T) {
  float t = clamp(T, 1000.0, 20000.0);
  vec3 c;
  c.r = 56100000.0 * pow(t, -1.5) + 148.0;
  c.g = (t > 6500.0) ? 35200000.0 * pow(t, -1.5) + 184.0
                     : 100.04 * log(t) - 623.6;
  c.b = 194.18 * log(t) - 1448.6;
  c = clamp(c, 0.0, 255.0) / 255.0;
  if (t < 1000.0) c *= t / 1000.0; // unreachable due to clamp, kept for safety
  return c;
}

// ---------------- procedural sky ----------------

vec3 rotY(vec3 d, float a) {
  float c = cos(a), s = sin(a);
  return vec3(c * d.x + s * d.z, d.y, -s * d.x + c * d.z);
}

vec3 starLayer(vec3 d, float scale, float presence, float seed) {
  // anti-moiré: fade layers whose cells fall below the pixel footprint
  float pxPerCell = (uResolution.y / (2.0 * uTanFov)) / scale;
  float aliasFade = smoothstep(2.0, 4.5, pxPerCell);
  if (aliasFade <= 0.002) return vec3(0.0);

  vec3 p = d * scale;
  vec3 id = floor(p);
  vec3 f = p - id;
  vec3 h = hash33(id + seed);
  float present = step(h.z, presence);
  vec3 sp = 0.5 + (hash33(id + seed + 11.1) - 0.5) * 0.55; // kept off cell borders
  float dd = length(f - sp);
  float sigma = 0.042 + 0.095 * h.x * h.x;
  // flux-conserving sub-pixel widening: unresolved stars keep their total
  // light but spread over ~0.75 px, killing sparkle/moiré
  float sigPx = sigma * pxPerCell;
  float sigEff = max(sigPx, 0.75);
  float fluxFix = (sigPx * sigPx) / (sigEff * sigEff);
  float sigCell = sigEff / pxPerCell;
  float g = exp(-(dd * dd) / (2.0 * sigCell * sigCell)) * fluxFix;
  float mag = hash13(id + seed + 3.1);
  float b = pow(mag, 8.0) * 30.0 + 0.10; // heavy tail: a few bright beacons
  float T = mix(2600.0, 11500.0, pow(hash13(id + seed + 9.7), 1.7));
  return blackbody(T) * (g * b * present * aliasFade);
}

vec3 milkyWay(vec3 d) {
  vec3 n = normalize(vec3(0.34, 0.76, 0.55));      // galactic plane normal
  vec3 gc = normalize(vec3(-0.62, 0.18, 0.76));    // galactic core direction
  float bd = dot(d, n);
  float band = exp(-bd * bd * 22.0);
  float core = pow(max(dot(d, gc), 0.0), 3.0);
  float clouds = fbm(d * 3.6 + 7.3, uOct);
  float dust   = fbm(d * 9.5 - 3.1, max(uOct - 1, 2));
  float m = band * (0.30 + 0.85 * clouds) * (1.0 - 0.72 * dust * band);
  vec3 tint = mix(vec3(0.52, 0.66, 1.00), vec3(1.00, 0.80, 0.55), clamp(core + 0.35 * clouds, 0.0, 1.0));
  return tint * m * (0.028 + 0.30 * core);
}

vec3 skyColor(vec3 d) {
  d = rotY(d, -uSkyAngle);
  vec3 col = vec3(0.010, 0.014, 0.024) * (0.35 + 0.65 * fbm(d * 2.2 + 4.2, 3)); // deep-space nebulosity
  col += milkyWay(d) * uMW;
  float presence = clamp(0.30 * uStarDensity, 0.0, 1.0);
  col += starLayer(d, 57.0, presence, 0.0) * 0.9;
  col += starLayer(d, 131.0, presence * 0.7, 41.7) * 0.45;
  return col * uStarBright;
}

// ---------------- accretion disk ----------------

vec4 diskEmission(vec3 hp, vec3 vdir, out float turbOut, out float doppOut, out float gravOut, out float tobsOut) {
  float r = length(hp.xz);

  float eIn  = smoothstep(uDiskInner, uDiskInner + 0.55, r);
  float eOut = 1.0 - smoothstep(uDiskOuter - 2.4, uDiskOuter, r);

  // Keplerian angular velocity  Ω = sqrt(M / r³),  M = 0.5
  float omega = 0.70710678 * inversesqrt(r * r * r);
  float phase = atan(hp.z, hp.x) + uTime * uOrbitSpeed * omega;

  // turbulence: isotropic fbm advected by differential rotation → shearing streaks
  vec2 dirv = vec2(cos(phase), sin(phase));
  vec3 np = vec3(dirv * (r * 0.55), r * 0.9) * uTurbScale;
  float n1 = fbm(np, uOct);
  float n2 = fbm(np * 2.7 - 11.3, max(uOct - 2, 2));
  float turb = mix(1.0, clamp(0.22 + 1.50 * n1 + 0.60 * (n2 - 0.5), 0.0, 1.5), uTurbAmp);

  float dens = eIn * eOut * turb;
  float alpha = clamp(dens * uDiskDensity * 0.9, 0.0, 1.0);

  // Shakura–Sunyaev-like temperature profile  T(r) = T_pk (r_in / r)^p
  float Temit = uDiskTemp * pow(uDiskInner / max(r, uDiskInner), uTempExp);

  // special-relativistic Doppler (Keplerian orbital speed β = sqrt(M/r), capped)
  float speed = min(sqrt(0.5 / r), 0.68);
  vec3 tangent = normalize(vec3(-hp.z, 0.0, hp.x));
  vec3 beta = tangent * speed;
  float gam = inversesqrt(max(1.0 - dot(beta, beta), 1e-4));
  vec3 toObs = -vdir; // photon momentum points from emitter toward the camera
  float dopp = 1.0 / (gam * (1.0 - dot(beta, toObs)));

  // gravitational redshift  emitter / camera
  float gcam = sqrt(max(1.0 - 1.0 / max(length(uCamPos), 1.001), 0.02));
  float gem  = sqrt(max(1.0 - 1.0 / max(r, 1.001), 0.02));
  float grav = gem / gcam;

  float shift = dopp * mix(1.0, grav, uGravShift);
  float Tobs  = Temit * shift;
  float boost = pow(max(shift, 0.02), uBeamExp);           // relativistic beaming
  float I = pow(uDiskInner / max(r, uDiskInner), uTempExp * 3.0)
          * boost * uDiskBright * (0.38 + 0.62 * turb);

  turbOut = turb; doppOut = dopp; gravOut = grav; tobsOut = Tobs;
  return vec4(blackbody(Tobs) * I, alpha);
}

// ---------------- geodesic tracer ----------------

struct Trace {
  vec3  col;
  float steps;
  bool  escaped;
  vec3  dir;      // final (lensed) direction
  float dopp;     // values at primary (densest) disk crossing
  float grav;
  float tobs;
  float turb;
  float hitR;
};

Trace traceRay(vec3 ro, vec3 rd) {
  Trace t;
  t.col = vec3(0.0);
  t.steps = 0.0;
  t.escaped = false;
  t.dir = rd;
  t.dopp = 1.0; t.grav = 1.0; t.tobs = 0.0; t.turb = 0.0; t.hitR = 0.0;

  vec3 p = ro;
  vec3 v = rd;
  float h2 = dot(cross(p, v), cross(p, v));
  float trans = 1.0;
  float bestA = -1.0;

  for (int i = 0; i < MAX_STEPS; i++) {
    if (i >= uSteps) break;
    t.steps = float(i);

    float r2 = dot(p, p);
    float r  = sqrt(r2);
    float dt = clamp((r - 0.92) * 0.11, 0.022, 2.0);

    vec3 a1 = -1.5 * h2 * p / (r2 * r2 * r);
    vec3 pn = p + v * dt + a1 * (0.5 * dt * dt);
    float rn2 = dot(pn, pn);
    vec3 an = -1.5 * h2 * pn / (rn2 * rn2 * sqrt(rn2));
    vec3 vn = v + (a1 + an) * (0.5 * dt);

    // equatorial-plane crossing → accretion disk sample
    if (uDebug != 3 && p.y * pn.y < 0.0) {
      float f = p.y / (p.y - pn.y);
      vec3 hp = mix(p, pn, f);
      float hr = length(hp.xz);
      if (hr > uDiskInner - 0.4 && hr < uDiskOuter + 0.5) {
        float tb, dp, gv, to;
        vec4 em = diskEmission(hp, normalize(vn), tb, dp, gv, to);
        if (em.a > 0.003) {
          t.col += trans * em.rgb * em.a;
          trans *= 1.0 - em.a;
          if (em.a > bestA) {
            bestA = em.a;
            t.dopp = dp; t.grav = gv; t.tobs = to; t.turb = tb; t.hitR = hr;
          }
          if (trans < 0.005) { p = pn; v = vn; break; }
        }
      }
    }

    p = pn; v = vn;

    float rn = sqrt(rn2);
    if (rn < 1.0) { break; }                          // crossed the horizon
    if (rn > uEscape && dot(p, v) > 0.0) {            // escaped to infinity
      t.escaped = true;
      break;
    }
  }

  t.dir = normalize(v);
  if (t.escaped && uDebug != 2) t.col += trans * skyColor(t.dir);
  return t;
}

// ---------------- main ----------------

void main() {
  vec2 ndc = vNdc;
  ndc.x *= uAspect;
  vec3 rd = normalize(uCamMat * vec3(ndc * uTanFov, 1.0));

  Trace t = traceRay(uCamPos, rd);

  vec3 col;

  if (uDebug == 1) {
    // step-count heatmap
    float s = clamp(t.steps / float(uSteps), 0.0, 1.0);
    col = vec3(pow(s, 0.6), 1.0 - abs(s - 0.5) * 1.6, pow(1.0 - s, 1.4)) * smoothstep(0.0, 0.08, s);
  } else if (uDebug == 4) {
    // deflection angle between initial and final direction
    float ang = acos(clamp(dot(t.dir, normalize(rd)), -1.0, 1.0));
    float a = ang / PI;
    col = mix(vec3(0.05, 0.35, 0.9), vec3(1.0, 0.45, 0.08), a) * (0.18 + 0.9 * sin(a * PI));
    if (length(t.col) > 0.0) col = mix(col, col * 1.6, 0.5);
  } else if (uDebug == 5) {
    // Doppler factor at primary crossing (no-hit stays neutral dark)
    float has = step(1e-4, t.hitR);
    float k = clamp((t.dopp - 1.0) * 1.6, -1.0, 1.0) * has;
    vec3 warm = vec3(1.0, 0.28, 0.06), cool = vec3(0.25, 0.65, 1.0);
    col = mix(vec3(0.012), (k > 0.0 ? cool : warm), abs(k)) * (0.12 + abs(k) * 0.88);
  } else if (uDebug == 55) {
    // Doppler factor at primary crossing
    float d = t.hitR > 0.0 ? t.dopp : 0.0;
    float k = clamp((d - 1.0) * 1.6, -1.0, 1.0);
    vec3 warm = vec3(1.0, 0.28, 0.06), cool = vec3(0.25, 0.65, 1.0);
    col = (k > 0.0 ? mix(vec3(0.02), cool, k) : mix(vec3(0.02), warm, -k)) * (0.15 + abs(k) * 0.85);
  } else if (uDebug == 6) {
    // gravitational redshift factor
    float g = t.hitR > 0.0 ? clamp(t.grav, 0.0, 1.0) : 0.0;
    col = vec3(g * g * 0.9 + g * 0.35, g * g * 0.75, g * g) + vec3(0.02);
  } else if (uDebug == 7) {
    // observed disk temperature (chroma only)
    col = t.hitR > 0.0 ? blackbody(t.tobs) * smoothstep(0.0, 0.2, t.turb) : vec3(0.0);
  } else if (uDebug == 8) {
    // turbulence field at primary crossing
    col = vec3(clamp(t.turb, 0.0, 1.0)) * smoothstep(0.0, 0.05, t.turb);
  } else {
    col = t.col; // beauty (0), disk-only (2), sky-only (3)
  }

  gl_FragColor = vec4(col, 1.0);
}
`;
