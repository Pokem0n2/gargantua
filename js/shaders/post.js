// ============================================================
// post.js — HDR post pipeline shaders
// bright-pass → separable gaussian blur (2 mip levels) → composite
// with ACES tonemap, dispersion (chromatic aberration), vignette,
// film grain and dithering.
// ============================================================

export const POST_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// ---------- bright pass (threshold + soft knee), half res ----------
export const BRIGHT_FRAG = /* glsl */`
varying vec2 vUv;
uniform sampler2D tScene;
uniform float uThreshold;
uniform float uSoft;

void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  float l = max(max(c.r, c.g), c.b);
  float knee = uSoft * uThreshold + 1e-4;
  float soft = clamp(l - uThreshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee);
  float w = max(soft, l - uThreshold) / max(l, 1e-4);
  gl_FragColor = vec4(c * w, 1.0);
}
`;

// ---------- separable gaussian blur, 9 taps ----------
export const BLUR_FRAG = /* glsl */`
varying vec2 vUv;
uniform sampler2D tIn;
uniform vec2 uDir; // texel-scaled direction, includes radius

void main() {
  vec3 c = texture2D(tIn, vUv).rgb * 0.227027;
  c += (texture2D(tIn, vUv + uDir * 1.3846).rgb +
        texture2D(tIn, vUv - uDir * 1.3846).rgb) * 0.3162162;
  c += (texture2D(tIn, vUv + uDir * 3.2308).rgb +
        texture2D(tIn, vUv - uDir * 3.2308).rgb) * 0.0702702;
  gl_FragColor = vec4(c, 1.0);
}
`;

// ---------- plain copy / downsample ----------
export const COPY_FRAG = /* glsl */`
varying vec2 vUv;
uniform sampler2D tIn;
void main() { gl_FragColor = texture2D(tIn, vUv); }
`;

// ---------- final composite ----------
export const COMPOSITE_FRAG = /* glsl */`
varying vec2 vUv;

uniform sampler2D tScene;
uniform sampler2D tBloom1; // half res
uniform sampler2D tBloom2; // quarter res
uniform float uBloomStrength;
uniform float uExposure;
uniform float uGrain;
uniform float uCA;
uniform float uTime;
uniform vec2  uResolution;
uniform int   uDebug;

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055,
             step(vec3(0.0031308), c));
}

void main() {
  // debug views 1..8 bypass the optical chain entirely
  if (uDebug >= 1 && uDebug <= 8) {
    gl_FragColor = vec4(texture2D(tScene, vUv).rgb, 1.0);
    return;
  }
  if (uDebug == 9) {
    vec3 b = texture2D(tBloom1, vUv).rgb * 0.55 + texture2D(tBloom2, vUv).rgb * 0.45;
    gl_FragColor = vec4(b * 2.2, 1.0);
    return;
  }

  vec2 uv = vUv;
  vec2 fromC = uv - 0.5;

  // lateral dispersion: radial chromatic aberration, quadratic falloff
  float r2 = dot(fromC, fromC);
  vec2 caOff = fromC * uCA * (0.6 + 2.4 * r2);

  vec3 col;
  col.r = texture2D(tScene, uv + caOff).r;
  col.g = texture2D(tScene, uv).g;
  col.b = texture2D(tScene, uv - caOff).b;

  vec3 bloom = texture2D(tBloom1, uv).rgb * 0.55 + texture2D(tBloom2, uv).rgb * 0.45;
  col += bloom * uBloomStrength;

  col *= uExposure;
  col = aces(col);
  col = linearToSrgb(col);

  // vignette
  float vig = smoothstep(1.42, 0.45, length(fromC * 2.0));
  col *= mix(0.68, 1.0, vig);

  // film grain (stronger in shadows) + dither
  float n = hash13(vec3(gl_FragCoord.xy, mod(uTime, 64.0) * 137.0)) - 0.5;
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col += n * (uGrain * (0.3 + 0.7 * (1.0 - luma)) + 0.004);

  gl_FragColor = vec4(col, 1.0);
}
`;
