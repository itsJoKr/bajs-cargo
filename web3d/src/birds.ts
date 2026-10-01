// Pigeons on the square: flocks that walk about pecking, and burst into the air
// (wings flapping, a wide arc) when the bike or car comes near, or a walker
// passes too close, then settle somewhere else on the paving.
//
// One InstancedMesh (about 150 triangles a bird). The wings and the pecking head
// are posed in the vertex shader from a per-instance phase, flap and peck value,
// like the crowd in people.ts.

import * as THREE from 'three';
import { CENTRE, type Crowd, type Threat } from './people.ts';

const enum_ = { Body: 0, Head: 1, Wing: 2, Fixed: 3 } as const;

interface Piece {
  g: THREE.BufferGeometry;
  part: number;
  limb: number; // 0 body, 1 left wing, 2 right wing, 3 head
  fixed?: string;
}

function birdPieces(): Piece[] {
  const P: Piece[] = [];
  // Body: a plump ellipsoid, chest forward.
  const body = new THREE.SphereGeometry(1, 10, 7);
  body.scale(0.072, 0.075, 0.155);
  body.translate(0, 0.105, 0);
  P.push({ g: body, part: enum_.Body, limb: 0 });
  // Chest puff.
  const chest = new THREE.SphereGeometry(1, 8, 6);
  chest.scale(0.06, 0.06, 0.06);
  chest.translate(0, 0.115, 0.085);
  P.push({ g: chest, part: enum_.Body, limb: 0 });
  // Neck and head (pivot for the peck at the neck base).
  const neck = new THREE.CylinderGeometry(0.03, 0.04, 0.07, 6);
  neck.rotateX(0.5);
  neck.translate(0, 0.175, 0.12);
  P.push({ g: neck, part: enum_.Head, limb: 3 });
  const head = new THREE.SphereGeometry(0.036, 8, 6);
  head.scale(0.9, 0.95, 1.1);
  head.translate(0, 0.205, 0.145);
  P.push({ g: head, part: enum_.Head, limb: 3 });
  const beak = new THREE.ConeGeometry(0.011, 0.04, 5);
  beak.rotateX(Math.PI / 2);
  beak.translate(0, 0.2, 0.19);
  P.push({ g: beak, part: enum_.Fixed, limb: 3, fixed: '#9b8a80' });
  const eye = new THREE.SphereGeometry(0.008, 4, 3);
  for (const s of [-1, 1]) P.push({ g: eye.clone().translate(s * 0.026, 0.212, 0.16), part: enum_.Fixed, limb: 3, fixed: '#d9862a' });
  // Tail: a flat wedge.
  const tail = new THREE.BoxGeometry(0.075, 0.012, 0.13);
  tail.rotateX(-0.25);
  tail.translate(0, 0.115, -0.2);
  P.push({ g: tail, part: enum_.Wing, limb: 0 });
  // Legs.
  for (const s of [-1, 1]) {
    const leg = new THREE.CylinderGeometry(0.006, 0.006, 0.075, 4);
    leg.translate(s * 0.03, 0.0375, 0.01);
    P.push({ g: leg, part: enum_.Fixed, limb: 0, fixed: '#b8626c' });
  }
  // Wings: a folded plate along the side that unfolds (spans out) in flight.
  for (const s of [-1, 1]) {
    const wing = new THREE.BufferGeometry();
    // Root at the shoulder (x = s*0.06), tip at x = s*0.27: a trapezoid, both faces.
    const r = 0.06, t = 0.27;
    const v = [
      [s * r, 0.13, 0.08], [s * r, 0.13, -0.13], [s * t, 0.13, -0.16], [s * t, 0.13, -0.04],
    ];
    const pos: number[] = [];
    const quad = (a: number[], b: number[], c: number[], d: number[]) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    quad(v[0], v[1], v[2], v[3]);
    quad(v[0], v[3], v[2], v[1]);
    wing.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    wing.computeVertexNormals();
    // Wing plates fold flat against the flank, so give them a thickness-less look but keep both faces.
    P.push({ g: wing, part: enum_.Wing, limb: s > 0 ? 1 : 2 });
  }
  return P;
}

function birdGeometry() {
  const geos: THREE.BufferGeometry[] = [];
  for (const p of birdPieces()) {
    const g = p.g.index ? p.g.toNonIndexed() : p.g.clone();
    if (g.getAttribute('normal') === undefined) g.computeVertexNormals();
    const n = g.getAttribute('position').count;
    const info = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) info.set([p.part, p.limb, 0], i * 3);
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 3));
    const c = new THREE.Color(p.fixed ?? '#ffffff');
    g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => [c.r, c.g, c.b][i % 3]), 3));
    g.deleteAttribute('uv');
    geos.push(g);
  }
  const names = ['position', 'normal', 'aInfo', 'color'];
  const merged = new THREE.BufferGeometry();
  for (const name of names) {
    const size = geos[0].getAttribute(name).itemSize;
    const total = geos.reduce((s, g) => s + g.getAttribute(name).count, 0);
    const out = new Float32Array(total * size);
    let at = 0;
    for (const g of geos) {
      out.set(g.getAttribute(name).array as Float32Array, at);
      at += g.getAttribute(name).array.length;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(out, size));
  }
  return merged;
}

const POSE_VERT = /* glsl */ `
attribute vec3 aInfo;   // part (colour), limb
attribute vec4 iAnim;   // phase, flap 0..1, peck 0..1, spare
#define aLimb aInfo.y
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
vec3 pose(vec3 v, float point) {
  float flap = iAnim.y, peck = iAnim.z, ph = iAnim.x;
  vec3 p = v;
  if (aLimb > 0.5 && aLimb < 2.5) {
    // Wings: fold against the flank on the ground, span out and beat in the air.
    float side = aLimb < 1.5 ? 1.0 : -1.0;
    vec3 sh = vec3(side * 0.06, 0.13, 0.0) * point;
    float spread = mix(0.2, 1.0, flap);
    vec3 q = p - sh;
    q.x *= spread;
    float beat = flap * (0.75 * sin(ph * 2.0) + 0.1);
    p = rotZ(-side * beat) * q + sh;
  } else if (aLimb > 2.5) {
    // Head: bobs with the step and dips to peck (pivot at the neck base).
    vec3 pivot = vec3(0.0, 0.15, 0.09) * point;
    p = rotX(peck * 1.0) * (p - pivot) + pivot;
    p.z += point * (1.0 - flap) * 0.012 * sin(ph * 2.0);
  }
  if (point > 0.5) {
    p.y += flap * 0.01 * sin(ph * 2.0);
  }
  return p;
}
`;

const POSE_COLOR = /* glsl */ `
attribute vec3 iBody;
attribute vec3 iHead;
attribute vec3 iWing;
varying vec3 vBirdColor;
`;

function birdMaterial() {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0, vertexColors: true, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${POSE_VERT}\n${POSE_COLOR}`)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = pose(vec3(normal), 0.0);')
      .replace('#include <begin_vertex>', 'vec3 transformed = pose(vec3(position), 1.0);')
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
{
  float part = aInfo.x;
  vec3 c = vec3(1.0);
  if (part < 0.5) c = iBody; else if (part < 1.5) c = iHead; else if (part < 2.5) c = iWing;
  vColor.rgb = c * color.rgb;
}`,
      );
  };
  return material;
}

function depthMaterial() {
  const material = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${POSE_VERT}`)
      .replace('#include <begin_vertex>', 'vec3 transformed = pose(vec3(position), 1.0);');
  };
  return material;
}

// [body, head, wing] colours.
const PLUMAGES: [string, string, string, number][] = [
  ['#9aa0a8', '#566572', '#7d848d', 70],
  ['#5d6168', '#39424a', '#3d4147', 12],
  ['#8b6c58', '#5a4a44', '#6d5546', 8],
  ['#e6e3dc', '#c8c5be', '#d2cfc8', 6],
  ['#b9bcc0', '#6e7783', '#a4a8ad', 4],
];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Flock {
  cx: number;
  cz: number;
  /** Seconds before it may be startled again. */
  cool: number;
  birds: Bird[];
}

interface Bird {
  x: number;
  y: number;
  z: number;
  h: number;
  phase: number;
  flap: number;
  peck: number;
  state: 'ground' | 'wait' | 'fly';
  /** Ground offset around the flock centre. */
  ox: number;
  oz: number;
  wx: number;
  wz: number;
  pause: number;
  delay: number;
  // Flight: start, target, elapsed and duration, arc height.
  sx: number;
  sy: number;
  sz: number;
  tx: number;
  ty: number;
  tz: number;
  t: number;
  T: number;
  arc: number;
  flock: Flock;
}

export class Pigeons {
  readonly root = new THREE.Group();
  readonly birds: Bird[] = [];
  private readonly flocks: Flock[] = [];
  private readonly mesh: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();
  private readonly rand: () => number;

  private readonly crowd: Crowd;
  /** Called when a flock takes off, with where it was (for the sound). */
  onScatter: ((x: number, y: number, z: number) => void) | null = null;

  constructor(crowd: Crowd, count: number, seed = 11) {
    this.crowd = crowd;
    this.rand = rng(seed);
    const geo = birdGeometry();
    const attr = (n: number) => new THREE.InstancedBufferAttribute(new Float32Array(count * n), n);
    const iAnim = attr(4), iBody = attr(3), iHead = attr(3), iWing = attr(3);
    geo.setAttribute('iAnim', iAnim);
    geo.setAttribute('iBody', iBody);
    geo.setAttribute('iHead', iHead);
    geo.setAttribute('iWing', iWing);
    this.mesh = new THREE.InstancedMesh(geo, birdMaterial(), count);
    this.mesh.customDepthMaterial = depthMaterial();
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
    this.root.name = 'pigeons';

    // Flocks of 5-10, spread over the square and its arms.
    let made = 0;
    let guard = 0;
    while (made < count && guard++ < 200) {
      const spot = crowd.spot(CENTRE.x, CENTRE.z, 4, 60);
      if (!spot) continue;
      const size = Math.min(count - made, 5 + Math.floor(this.rand() * 6));
      const flock: Flock = { cx: spot.x, cz: spot.z, cool: this.rand() * 4, birds: [] };
      for (let k = 0; k < size; k++) {
        const a = this.rand() * Math.PI * 2, r = Math.sqrt(this.rand()) * 2.6;
        const b: Bird = {
          x: spot.x + Math.sin(a) * r, y: spot.y, z: spot.z + Math.cos(a) * r, h: this.rand() * Math.PI * 2,
          phase: this.rand() * 6, flap: 0, peck: 0, state: 'ground', ox: Math.sin(a) * r, oz: Math.cos(a) * r,
          wx: 0, wz: 0, pause: this.rand() * 3, delay: 0, sx: 0, sy: 0, sz: 0, tx: 0, ty: 0, tz: 0, t: 0, T: 1, arc: 0,
          flock,
        };
        b.wx = b.x;
        b.wz = b.z;
        flock.birds.push(b);
        this.birds.push(b);
        const i = made++;
        // Plumage by weight.
        let w = this.rand() * PLUMAGES.reduce((s, p) => s + p[3], 0);
        let pl = PLUMAGES[0];
        for (const p of PLUMAGES) {
          if ((w -= p[3]) <= 0) {
            pl = p;
            break;
          }
        }
        const tint = (a: THREE.InstancedBufferAttribute, hex: string) => {
          const c = new THREE.Color(hex);
          // A little variation between birds.
          const v = 0.9 + this.rand() * 0.2;
          a.setXYZ(i, c.r * v, c.g * v, c.b * v);
        };
        tint(iBody, pl[0]);
        tint(iHead, pl[1]);
        tint(iWing, pl[2]);
      }
      this.flocks.push(flock);
    }
    this.mesh.count = this.birds.length;
    this.place();
  }

  /** Where the flocks are, for their cooing. */
  flockSpots(): { x: number; y: number; z: number }[] {
    return this.flocks.map((f) => ({ x: f.cx, y: this.crowd.heightAt(f.cx, f.cz) + 0.3, z: f.cz }));
  }

  private scatter(flock: Flock, fromX: number, fromZ: number) {
    this.onScatter?.(flock.cx, this.crowd.heightAt(flock.cx, flock.cz) + 1, flock.cz);
    // Land somewhere else: 14-40 m off, away from what startled them.
    let best: { x: number; z: number; y: number } | null = null;
    for (let tries = 0; tries < 8; tries++) {
      const s = this.crowd.spot(flock.cx, flock.cz, 14, 40, 70);
      if (!s) continue;
      if (Math.hypot(s.x - fromX, s.z - fromZ) < 14) continue;
      best = s;
      break;
    }
    if (!best) best = this.crowd.spot(flock.cx, flock.cz, 8, 30, 70);
    if (!best) return;
    flock.cx = best.x;
    flock.cz = best.z;
    flock.cool = 5 + this.rand() * 4;
    for (const b of flock.birds) {
      b.state = 'wait';
      b.delay = this.rand() * 0.35;
      // Each bird lands at its own place near the new centre.
      const a = this.rand() * Math.PI * 2, r = Math.sqrt(this.rand()) * 2.4;
      b.ox = Math.sin(a) * r;
      b.oz = Math.cos(a) * r;
    }
  }

  step(dt: number, threats: Threat[]) {
    const people = this.crowd.people;
    for (const flock of this.flocks) {
      flock.cool = Math.max(0, flock.cool - dt);
      if (flock.cool > 0) continue;
      // Startled by the car, or by a walker who came close.
      let sx = 0, sz = 0, scared = false;
      for (const b of flock.birds) {
        if (b.state !== 'ground') continue;
        for (let i = 0; i < 1 && i < threats.length; i++) {
          const t = threats[i]; // the vehicle
          const reach = t.r + 3.5 + Math.hypot(t.vx, t.vz) * 0.8;
          if (Math.hypot(b.x - t.x, b.z - t.z) < reach) {
            scared = true;
            sx = t.x;
            sz = t.z;
          }
        }
        if (scared) break;
        // A walker: one who steps within 1.7 m of a bird.
        for (const p of people) {
          if (p.state === 'sit' || p.speed < 0.5) continue;
          const dx = b.x - p.x, dz = b.z - p.z;
          if (dx * dx + dz * dz < 2.9) {
            scared = true;
            sx = p.x;
            sz = p.z;
            break;
          }
        }
        if (scared) break;
      }
      if (scared) this.scatter(flock, sx, sz);
    }
    for (const b of this.birds) this.stepBird(b, dt);
  }

  private stepBird(b: Bird, dt: number) {
    if (b.state === 'wait') {
      b.delay -= dt;
      if (b.delay <= 0) {
        b.state = 'fly';
        b.sx = b.x;
        b.sy = b.y;
        b.sz = b.z;
        const spot = this.crowd.spot(b.flock.cx + b.ox, b.flock.cz + b.oz, 0, 1.5, 90) ?? { x: b.flock.cx + b.ox, z: b.flock.cz + b.oz, y: b.y };
        b.tx = spot.x;
        b.tz = spot.z;
        b.ty = spot.y;
        const d = Math.hypot(b.tx - b.sx, b.tz - b.sz);
        b.T = 1.3 + d / 7;
        b.t = 0;
        b.arc = 2.5 + this.rand() * 5 + d * 0.06;
        b.h = Math.atan2(b.tx - b.sx, b.tz - b.sz);
      }
      return;
    }
    if (b.state === 'fly') {
      b.t += dt;
      const u = Math.min(1, b.t / b.T);
      // Ease out of the takeoff, glide in at the end.
      const e = u * u * (3 - 2 * u);
      b.x = b.sx + (b.tx - b.sx) * e;
      b.z = b.sz + (b.tz - b.sz) * e;
      b.y = b.sy + (b.ty - b.sy) * e + Math.sin(Math.PI * Math.pow(u, 0.75)) * b.arc;
      b.phase += dt * 15;
      b.flap += ((u > 0.85 ? 0.55 : 1) - b.flap) * Math.min(1, dt * 12);
      b.peck = 0;
      if (u >= 1) {
        b.state = 'ground';
        b.wx = b.x;
        b.wz = b.z;
        b.pause = 0.3 + this.rand() * 2;
      }
      return;
    }
    // On the ground: walk toward a nearby point, stop to peck.
    b.flap += (0 - b.flap) * Math.min(1, dt * 10);
    b.pause -= dt;
    const dx = b.wx - b.x, dz = b.wz - b.z;
    const d = Math.hypot(dx, dz);
    if (b.pause > 0) {
      // Pecking while stopped: the head dips a few times a second.
      b.peck += (((Math.sin(b.phase * 3) > 0.2 ? 1 : 0) * 0.9 - b.peck)) * Math.min(1, dt * 14);
      b.phase += dt * 3;
      return;
    }
    if (d < 0.1) {
      b.pause = 0.4 + this.rand() * 2.4;
      const a = this.rand() * Math.PI * 2, r = Math.sqrt(this.rand()) * 2.6;
      b.wx = b.flock.cx + Math.sin(a) * r;
      b.wz = b.flock.cz + Math.cos(a) * r;
      return;
    }
    b.peck += (0 - b.peck) * Math.min(1, dt * 10);
    const sp = 0.5;
    b.x += (dx / d) * sp * dt;
    b.z += (dz / d) * sp * dt;
    let da = Math.atan2(dx, dz) - b.h;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    b.h += Math.max(-6 * dt, Math.min(6 * dt, da));
    b.phase += dt * sp * 22;
    b.y += (this.crowd.heightAt(b.x, b.z) - b.y) * Math.min(1, dt * 10);
  }

  place() {
    const anim = this.mesh.geometry.getAttribute('iAnim') as THREE.InstancedBufferAttribute;
    const d = this.dummy;
    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i];
      d.position.set(b.x, b.y, b.z);
      d.rotation.set(b.state === 'fly' ? -0.15 : 0, b.h, 0);
      d.scale.setScalar(1);
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
      anim.setXYZW(i, b.phase, b.flap, b.peck, 0);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    anim.needsUpdate = true;
  }
}
