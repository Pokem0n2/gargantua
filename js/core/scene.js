// ============================================================
// scene.js — WebGL pipeline: HDR raytrace → bloom mips → composite
// ============================================================

import * as THREE from 'three';
import { BLACKHOLE_VERT, BLACKHOLE_FRAG } from '../shaders/blackhole.js';
import { POST_VERT, BRIGHT_FRAG, BLUR_FRAG, COPY_FRAG, COMPOSITE_FRAG } from '../shaders/post.js';

export const QUALITY_PRESETS = {
  standard:  { scale: 0.62, dprCap: 1.5, steps: 220, oct: 4, label: 'STANDARD'  },
  high:      { scale: 0.85, dprCap: 2.0, steps: 340, oct: 5, label: 'HIGH'      },
  cinematic: { scale: 1.0,  dprCap: 2.0, steps: 500, oct: 6, label: 'CINEMATIC' },
};

class FsPass {
  constructor(vertexShader, fragmentShader, uniforms) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.material = new THREE.ShaderMaterial({
      vertexShader, fragmentShader, uniforms,
      depthTest: false, depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }
  render(renderer, target) {
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
  }
  dispose() {
    this.material.dispose();
    this.scene.children[0].geometry.dispose();
  }
}

function makeRT(w, h, type) {
  return new THREE.WebGLRenderTarget(Math.max(2, w), Math.max(2, h), {
    type, format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: false, stencilBuffer: false,
  });
}

export class Pipeline {
  constructor(canvas) {
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false, alpha: false, depth: false, stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.debug.checkShaderErrors = true;

    const gl = this.renderer.getContext();
    this.isWebGL2 = this.renderer.capabilities.isWebGL2;
    const floatOK = !!(gl.getExtension('EXT_color_buffer_float') ||
                       gl.getExtension('EXT_color_buffer_half_float'));
    this.hdrType = floatOK ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.hdr = floatOK;

    // quality state
    this.qualityKey = 'standard';
    this.q = { ...QUALITY_PRESETS.standard };
    this.scaleMul = 1.0;   // extra URL override (?scale=0.4)
    this.bloomSpread = 1.1;
    this.rw = 2; this.rh = 2;
    this.cssW = 2; this.cssH = 2;

    this.buildMaterials();
    this.buildTargets();
  }

  buildMaterials() {
    this.bhUniforms = {
      uResolution: { value: new THREE.Vector2(2, 2) },
      uTime:       { value: 0 },
      uCamPos:     { value: new THREE.Vector3(0, 1, 7) },
      uCamMat:     { value: new THREE.Matrix3() },
      uTanFov:     { value: Math.tan(THREE.MathUtils.degToRad(60) * 0.5) },
      uAspect:     { value: 1 },
      uSteps:      { value: 220 },
      uOct:        { value: 4 },
      uDebug:      { value: 0 },
      uEscape:     { value: 40 },

      uDiskInner:  { value: 3.0 },
      uDiskOuter:  { value: 11.0 },
      uDiskBright: { value: 1.6 },
      uDiskTemp:   { value: 6600 },
      uTempExp:    { value: 0.75 },
      uBeamExp:    { value: 2.4 },
      uGravShift:  { value: 1.0 },
      uDiskDensity:{ value: 1.0 },
      uTurbAmp:    { value: 0.55 },
      uTurbScale:  { value: 1.2 },
      uOrbitSpeed: { value: 1.0 },

      uStarDensity:{ value: 1.0 },
      uStarBright: { value: 1.2 },
      uMW:         { value: 0.9 },
      uSkyAngle:   { value: 0 },
    };
    this.bh = new FsPass(BLACKHOLE_VERT, BLACKHOLE_FRAG, this.bhUniforms);

    this.bright = new FsPass(POST_VERT, BRIGHT_FRAG, {
      tScene:     { value: null },
      uThreshold: { value: 0.8 },
      uSoft:      { value: 0.6 },
    });
    this.blurH = new FsPass(POST_VERT, BLUR_FRAG, { tIn: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.blurV = new FsPass(POST_VERT, BLUR_FRAG, { tIn: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.copy  = new FsPass(POST_VERT, COPY_FRAG,  { tIn: { value: null } });

    this.composite = new FsPass(POST_VERT, COMPOSITE_FRAG, {
      tScene:  { value: null },
      tBloom1: { value: null },
      tBloom2: { value: null },
      uBloomStrength: { value: 1.0 },
      uExposure:      { value: 1.15 },
      uGrain:         { value: 0.045 },
      uCA:            { value: 0.0018 },
      uTime:          { value: 0 },
      uResolution:    { value: new THREE.Vector2(2, 2) },
      uDebug:         { value: 0 },
    });
  }

  buildTargets() {
    this.disposeTargets();
    const { rw, rh } = this;
    this.rtScene = makeRT(rw, rh, this.hdrType);
    this.rtHalfA = makeRT(rw >> 1, rh >> 1, this.hdrType);
    this.rtHalfB = makeRT(rw >> 1, rh >> 1, this.hdrType);
    this.rtQuadA = makeRT(rw >> 2, rh >> 2, this.hdrType);
    this.rtQuadB = makeRT(rw >> 2, rh >> 2, this.hdrType);
  }

  disposeTargets() {
    for (const k of ['rtScene', 'rtHalfA', 'rtHalfB', 'rtQuadA', 'rtQuadB']) {
      if (this[k]) { this[k].dispose(); this[k] = null; }
    }
  }

  setQuality(key, scaleMul = 1.0) {
    this.qualityKey = key;
    this.q = { ...QUALITY_PRESETS[key] };
    this.scaleMul = scaleMul;
    this.bhUniforms.uSteps.value = this.q.steps;
    this.bhUniforms.uOct.value = this.q.oct;
  }

  resize(cssW, cssH) {
    this.cssW = cssW; this.cssH = cssH;
    const dpr = Math.min(window.devicePixelRatio || 1, this.q.dprCap);
    const eff = Math.max(0.2, dpr * this.q.scale * this.scaleMul);
    this.renderer.setPixelRatio(eff);
    this.renderer.setSize(cssW, cssH, false);

    this.rw = Math.max(2, Math.round(cssW * eff));
    this.rh = Math.max(2, Math.round(cssH * eff));

    this.buildTargets();

    this.bhUniforms.uResolution.value.set(this.rw, this.rh);
    this.bhUniforms.uAspect.value = cssW / cssH;
    this.composite.material.uniforms.uResolution.value.set(this.rw, this.rh);
  }

  get renderSize() { return { w: this.rw, h: this.rh, quality: this.q.label }; }

  syncParams(p) {
    const u = this.bhUniforms;
    u.uDiskInner.value = p.diskInner;
    u.uDiskOuter.value = p.diskOuter;
    u.uDiskBright.value = p.diskBright;
    u.uDiskTemp.value = p.diskTemp;
    u.uTempExp.value = p.tempExp;
    u.uBeamExp.value = p.beamExp;
    u.uGravShift.value = p.gravShift;
    u.uDiskDensity.value = p.diskDensity;
    u.uTurbAmp.value = p.turbAmp;
    u.uTurbScale.value = p.turbScale;
    u.uOrbitSpeed.value = p.orbitSpeed;
    u.uStarDensity.value = p.starDensity;
    u.uStarBright.value = p.starBright;
    u.uMW.value = p.mwIntensity;
    // skyRotate accumulates into uSkyAngle in the main loop (pause-aware)

    const c = this.composite.material.uniforms;
    c.uBloomStrength.value = p.bloomStrength;
    c.uExposure.value = p.exposure;
    c.uGrain.value = p.grain;
    c.uCA.value = p.chroma;
    this.bloomSpread = p.bloomRadius;
    this.bright.material.uniforms.uThreshold.value = p.bloomThresh;
  }

  setCamera(pos, mat3, fovDeg) {
    this.bhUniforms.uCamPos.value.copy(pos);
    this.bhUniforms.uCamMat.value.copy(mat3);
    this.bhUniforms.uTanFov.value = Math.tan(THREE.MathUtils.degToRad(fovDeg) * 0.5);
    const camR = pos.length();
    this.bhUniforms.uEscape.value = Math.max(40, camR * 1.15 + 5);
  }

  setFrame(simTime, realTime, skyAngle, debugView) {
    this.bhUniforms.uTime.value = simTime;
    this.bhUniforms.uSkyAngle.value = skyAngle;
    this.bhUniforms.uDebug.value = debugView;
    this.composite.material.uniforms.uDebug.value = debugView;
    this.composite.material.uniforms.uTime.value = realTime;
  }

  renderFrame() {
    const r = this.renderer;
    const bl = this.blurH.material.uniforms, bv = this.blurV.material.uniforms;
    const spread = 0.5 + this.bloomSpread; // bloomRadius drives gaussian reach

    // 1. spacetime raytrace → HDR
    this.bh.render(r, this.rtScene);

    // 2. bright pass at half res
    this.bright.material.uniforms.tScene.value = this.rtScene.texture;
    this.bright.render(r, this.rtHalfA);

    // 3. blur level 1 (half)
    const tx1 = 1.0 / this.rtHalfA.width, ty1 = 1.0 / this.rtHalfA.height;
    bl.tIn.value = this.rtHalfA.texture; bl.uDir.value.set(tx1 * spread, 0);
    this.blurH.render(r, this.rtHalfB);
    bv.tIn.value = this.rtHalfB.texture; bv.uDir.value.set(0, ty1 * spread);
    this.blurV.render(r, this.rtHalfA);

    // 4. downsample to quarter
    this.copy.material.uniforms.tIn.value = this.rtHalfA.texture;
    this.copy.render(r, this.rtQuadA);

    // 5. blur level 2 (quarter, wider)
    const tx2 = 2.0 / this.rtQuadA.width, ty2 = 2.0 / this.rtQuadA.height;
    bl.tIn.value = this.rtQuadA.texture; bl.uDir.value.set(tx2 * spread, 0);
    this.blurH.render(r, this.rtQuadB);
    bv.tIn.value = this.rtQuadB.texture; bv.uDir.value.set(0, ty2 * spread);
    this.blurV.render(r, this.rtQuadA);

    // 6. composite to screen
    const cu = this.composite.material.uniforms;
    cu.tScene.value = this.rtScene.texture;
    cu.tBloom1.value = this.rtHalfA.texture;
    cu.tBloom2.value = this.rtQuadA.texture;
    this.composite.render(r, null);
    r.setRenderTarget(null);
  }

  dispose() {
    this.disposeTargets();
    for (const p of [this.bh, this.bright, this.blurH, this.blurV, this.copy, this.composite]) p.dispose();
    this.renderer.dispose();
  }
}
