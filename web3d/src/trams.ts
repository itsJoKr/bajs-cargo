// ZET trams on the real tracks: the OSM tram ways are chained into long
// routes, and three-section low-floor trams run along them, each section
// following the rails on its own (so they bend through curves), each a
// kinematic Rapier body the car can hit. A tram slows and stops for the car
// when it is on the track ahead.

import * as THREE from 'three';
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

type P = [number, number];

/** A route: points every metre along a chain of tracks, with heights. */
interface Route {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  length: number;
}

const SECTION = 10.6; // metres per section
const GAP = 0.6;
const SECTIONS = 3;
const CRUISE = 9; // m/s, about 32 km/h

/** Joins track ways that meet end to start into long chains. */
function chain(lines: P[][]): P[][] {
  const key = (p: P) => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;
  const starts = new Map<string, number[]>();
  lines.forEach((l, i) => {
    const k = key(l[0]);
    starts.set(k, [...(starts.get(k) ?? []), i]);
  });
  const ends = new Set(lines.map((l) => key(l[l.length - 1])));
  const used = new Set<number>();
  const out: P[][] = [];
  // Start where nothing leads in, then pick up the loops.
  const order = [...lines.keys()].sort((a, b) => Number(ends.has(key(lines[a][0]))) - Number(ends.has(key(lines[b][0]))));
  for (const i of order) {
    if (used.has(i)) continue;
    used.add(i);
    const c = [...lines[i]];
    for (;;) {
      const tail = c[c.length - 1], prev = c[c.length - 2];
      const dir = Math.atan2(tail[1] - prev[1], tail[0] - prev[0]);
      let best = -1, bestTurn = 0.9;
      for (const j of starts.get(key(tail)) ?? []) {
        if (used.has(j)) continue;
        const l = lines[j];
        const d2 = Math.atan2(l[1][1] - l[0][1], l[1][0] - l[0][0]);
        const turn = Math.abs(Math.atan2(Math.sin(d2 - dir), Math.cos(d2 - dir)));
        if (turn < bestTurn) {
          bestTurn = turn;
          best = j;
        }
      }
      if (best < 0) break;
      used.add(best);
      c.push(...lines[best].slice(1));
    }
    out.push(c);
  }
  return out;
}

/** Resamples [line] every metre, keeping only the run inside [inside]. */
function resample(line: P[], inside: (x: number, z: number) => boolean, height: (x: number, z: number) => number) {
  const xs: number[] = [], zs: number[] = [];
  let carry = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, az] = line[i], [bx, bz] = line[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    for (let s = carry; s < len; s += 1) {
      xs.push(ax + ((bx - ax) * s) / len);
      zs.push(az + ((bz - az) * s) / len);
    }
    carry = (carry - len) % 1;
    if (carry < 0) carry += 1;
  }
  // The longest run inside the extent.
  let bestA = 0, bestB = -1, a = -1;
  for (let i = 0; i <= xs.length; i++) {
    const ok = i < xs.length && inside(xs[i], zs[i]);
    if (ok && a < 0) a = i;
    if (!ok && a >= 0) {
      if (i - a > bestB - bestA) [bestA, bestB] = [a, i];
      a = -1;
    }
  }
  const n = bestB - bestA;
  if (n < 2) return null;
  const route: Route = { x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n), length: n - 1 };
  for (let i = 0; i < n; i++) {
    route.x[i] = xs[bestA + i];
    route.z[i] = zs[bestA + i];
    route.y[i] = height(route.x[i], route.z[i]);
  }
  // Smooth the heights so the tram does not jitter over kerb edges.
  const y = Float32Array.from(route.y);
  for (let i = 0; i < n; i++) {
    let sum = 0, cnt = 0;
    for (let k = -4; k <= 4; k++) {
      const j = i + k;
      if (j >= 0 && j < n) {
        sum += y[j];
        cnt++;
      }
    }
    route.y[i] = sum / cnt;
  }
  return route;
}

function sample(r: Route, s: number, out: THREE.Vector3) {
  const t = Math.max(0, Math.min(r.length - 1e-4, s));
  const i = Math.floor(t), f = t - i;
  out.set(r.x[i] + (r.x[i + 1] - r.x[i]) * f, r.y[i] + (r.y[i + 1] - r.y[i]) * f, r.z[i] + (r.z[i + 1] - r.z[i]) * f);
  return out;
}

/** One tram section, 10.6 m, facing +z: blue body, window band, roof. */
function sectionGeometry(front: boolean) {
  const parts: THREE.BufferGeometry[] = [];
  const colored = (g: THREE.BufferGeometry, hex: number) => {
    const c = new THREE.Color(hex);
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    return g;
  };
  const w = 2.3, L = SECTION;
  parts.push(colored(new THREE.BoxGeometry(w, 1.1, L).translate(0, 0.35 + 0.55, 0), 0x1f5fb0));
  parts.push(colored(new THREE.BoxGeometry(w - 0.02, 1.25, L - 0.3).translate(0, 1.45 + 0.625, 0), 0x1b232c));
  parts.push(colored(new THREE.BoxGeometry(w, 0.35, L).translate(0, 2.7 + 0.175, 0), 0x1f5fb0));
  parts.push(colored(new THREE.BoxGeometry(w - 0.3, 0.45, L * 0.7).translate(0, 3.05 + 0.225, 0), 0xd9dde2));
  parts.push(colored(new THREE.BoxGeometry(w + 0.02, 0.12, L).translate(0, 1.4, 0), 0xf2f2f2));
  // Door panels on the right side (the platform side of a one-way track).
  for (const dz of [-3, 2.5]) {
    parts.push(colored(new THREE.BoxGeometry(0.04, 2.2, 1.3).translate(-w / 2 - 0.01, 1.45, dz), 0x2c3a48));
  }
  if (front) {
    // A sloped nose with a windscreen, and a pantograph on the roof.
    parts.push(colored(new THREE.BoxGeometry(w - 0.1, 1.5, 0.5).translate(0, 2.0, L / 2 + 0.2), 0x151b22));
    parts.push(colored(new THREE.BoxGeometry(w - 0.1, 1.0, 0.45).translate(0, 0.9, L / 2 + 0.2), 0x1f5fb0));
    parts.push(colored(new THREE.BoxGeometry(1.4, 0.08, 0.08).translate(0, 4.15, 0), 0x333333));
    parts.push(colored(new THREE.BoxGeometry(0.06, 0.9, 0.06).rotateX(0.5).translate(0, 3.7, 0.2), 0x333333));
  }
  return mergeGeometries(parts)!;
}

interface Tram {
  route: Route;
  s: number;
  prevS: number;
  speed: number;
  meshes: THREE.Mesh[];
  bodies: RAPIER_NS.RigidBody[];
}

export class Trams {
  readonly root = new THREE.Group();
  private readonly trams: Tram[] = [];
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();

  constructor(
    R: typeof RAPIER_NS,
    world: RAPIER_NS.World,
    lines: P[][],
    inside: (x: number, z: number) => boolean,
    height: (x: number, z: number) => number,
  ) {
    this.root.name = 'trams';
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.2 });
    const frontGeo = sectionGeometry(true), midGeo = sectionGeometry(false);
    const routes = chain(lines)
      .map((c) => resample(c, inside, height))
      .filter((r): r is Route => !!r && r.length > 120);
    const tramLength = SECTIONS * SECTION + (SECTIONS - 1) * GAP;
    for (const route of routes) {
      // One tram per ~150 m of route, spread out.
      const count = Math.max(1, Math.floor(route.length / 150));
      for (let k = 0; k < count; k++) {
        const meshes: THREE.Mesh[] = [];
        const bodies: RAPIER_NS.RigidBody[] = [];
        for (let i = 0; i < SECTIONS; i++) {
          const mesh = new THREE.Mesh(i === 0 ? frontGeo : midGeo, material);
          mesh.castShadow = mesh.receiveShadow = true;
          this.root.add(mesh);
          meshes.push(mesh);
          const body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
          world.createCollider(R.ColliderDesc.cuboid(1.15, 1.6, SECTION / 2).setTranslation(0, 1.9, 0), body);
          bodies.push(body);
        }
        const s = tramLength + ((route.length - tramLength) * (k + 0.3)) / count;
        this.trams.push({ route, s, prevS: s, speed: CRUISE, meshes, bodies });
      }
    }
    this.place(1);
    this.syncBodies(true);
  }

  get count() {
    return this.trams.length;
  }

  /** One physics step. [car] is the car's position, to stop for it. */
  step(dt: number, car: THREE.Vector3) {
    const tramLength = SECTIONS * SECTION + (SECTIONS - 1) * GAP;
    for (const t of this.trams) {
      t.prevS = t.s;
      // Is the car on the rails ahead, within braking distance?
      let target = CRUISE;
      const nose = sample(t.route, t.s, this.tmpA);
      const ahead = sample(t.route, t.s + 4, this.tmpB).sub(nose).normalize();
      const dx = car.x - nose.x, dz = car.z - nose.z;
      const along = dx * ahead.x + dz * ahead.z;
      const across = Math.abs(dx * ahead.z - dz * ahead.x);
      if (along > -1 && along < 28 && across < 2.6 && Math.abs(car.y - nose.y) < 3) {
        target = Math.max(0, (along - 6) * 0.45);
      }
      const accel = target < t.speed ? 3.2 : 1.1;
      t.speed += Math.max(-accel * dt, Math.min(accel * dt, target - t.speed));
      t.s += t.speed * dt;
      if (t.s > t.route.length) {
        // Leave the city at the far end, come back in at the start.
        t.s = tramLength;
        t.prevS = t.s;
      }
    }
    this.syncBodies(false);
  }

  private sectionPose(t: Tram, s: number, i: number, pos: THREE.Vector3, quat: THREE.Quaternion) {
    // Each section rides on its own two bogies.
    const frontS = s - i * (SECTION + GAP);
    const a = sample(t.route, frontS - 1.2, this.tmpA);
    const b = sample(t.route, frontS - SECTION + 1.2, this.tmpB);
    pos.copy(a).add(b).multiplyScalar(0.5);
    const yaw = Math.atan2(a.x - b.x, a.z - b.z);
    const pitch = -Math.atan2(a.y - b.y, Math.hypot(a.x - b.x, a.z - b.z));
    quat.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  }

  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();

  private syncBodies(teleport: boolean) {
    for (const t of this.trams) {
      for (let i = 0; i < SECTIONS; i++) {
        this.sectionPose(t, t.s, i, this.pos, this.quat);
        const body = t.bodies[i];
        if (teleport) {
          body.setTranslation(this.pos, true);
          body.setRotation(this.quat, true);
        } else {
          body.setNextKinematicTranslation(this.pos);
          body.setNextKinematicRotation(this.quat);
        }
      }
    }
  }

  /** Poses the meshes between the last two steps. */
  place(alpha: number) {
    for (const t of this.trams) {
      const jumped = t.s < t.prevS;
      const s = jumped ? t.s : t.prevS + (t.s - t.prevS) * alpha;
      for (let i = 0; i < SECTIONS; i++) {
        this.sectionPose(t, s, i, this.pos, this.quat);
        t.meshes[i].position.copy(this.pos);
        t.meshes[i].quaternion.copy(this.quat);
      }
    }
  }
}
