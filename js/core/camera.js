// ============================================================
// camera.js — orbit controls, 4 view presets, cinematic loop
// ============================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const VIEW_PRESETS = [
  { name: 'EQUATOR',    r: 7.6,  polDeg: 87.3, azi: 0.45 },  // edge-on, Interstellar framing
  { name: 'ZENITH',     r: 8.8,  polDeg: 16.0, azi: 1.35 },  // face-on spiral view
  { name: 'PERIHELION', r: 5.4,  polDeg: 82.5, azi: 2.25 },  // close orbit, photon ring looming
  { name: 'DEEP FIELD', r: 19.0, polDeg: 66.0, azi: 0.15 },  // distant overview
];

const DEG = Math.PI / 180;
const smootherstep = t => t * t * t * (t * (t * 6 - 15) + 10);
const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));

export class CameraRig {
  constructor(camera, domElement, onUserGrab) {
    this.camera = camera;
    this.tween = null;
    this.cinematic = false;
    this.cinTime = 0;
    this.onUserGrab = onUserGrab || (() => {});

    this.controls = new OrbitControls(camera, domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.enablePan = false;
    this.controls.minDistance = 1.55;
    this.controls.maxDistance = 60;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.8;
    this.controls.update();

    this.controls.addEventListener('start', () => {
      this.tween = null;
      if (this.cinematic) { this.cinematic = false; }
      this.onUserGrab();
    });
  }

  get isBusy() { return this.cinematic || this.tween !== null; }

  preset(i, immediate = false) {
    const p = VIEW_PRESETS[i % VIEW_PRESETS.length];
    const s = new THREE.Spherical().setFromVector3(this.camera.position);
    const to = { r: p.r, pol: p.polDeg * DEG, azi: p.azi };
    if (immediate) {
      this.camera.position.setFromSphericalCoords(to.r, to.pol, to.azi);
      this.camera.lookAt(0, 0, 0);
      this.controls.update();
      this.tween = null;
      return p.name;
    }
    this.tween = {
      from: { r: s.radius, pol: s.phi, azi: s.theta },
      to, t: 0, dur: 2.6,
    };
    this.controls.enabled = false;
    this.cinematic = false;
    return p.name;
  }

  startCinematic() {
    this.cinematic = true;
    this.tween = null;
    this.controls.enabled = false;
    const s = new THREE.Spherical().setFromVector3(this.camera.position);
    this.cinAz0 = s.theta;
    this.cinTime = 0;
  }

  stopCinematic(resumeControls = true) {
    this.cinematic = false;
    if (resumeControls) this.controls.enabled = true;
  }

  update(dt) {
    if (this.tween) {
      const tw = this.tween;
      tw.t += dt / tw.dur;
      const k = smootherstep(Math.min(tw.t, 1.0));
      const r = THREE.MathUtils.lerp(tw.from.r, tw.to.r, k);
      const pol = THREE.MathUtils.lerp(tw.from.pol, tw.to.pol, k);
      const azi = tw.from.azi + wrapPi(tw.to.azi - tw.from.azi) * k;
      this.camera.position.setFromSphericalCoords(r, pol, azi);
      this.camera.lookAt(0, 0, 0);
      if (tw.t >= 1.0) { this.tween = null; this.controls.enabled = true; }
    } else if (this.cinematic) {
      this.cinTime += dt;
      const t = this.cinTime;
      const az = this.cinAz0 + t * 0.055;
      const rad = 6.2 + 3.1 * Math.sin(t * 0.041 + 1.3);
      const pol = (74 + 9.5 * Math.sin(t * 0.027 + 0.7)) * DEG;
      this.camera.position.setFromSphericalCoords(rad, pol, az);
      this.camera.lookAt(0, 0, 0);
    } else {
      this.controls.update();
    }
  }
}
