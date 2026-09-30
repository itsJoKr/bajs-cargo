// ZET trams on the real tracks: the OSM tram ways are chained into long
// routes, and five-module ZET TMK 2200 low-floor trams run along them, each
// module following the rails on its own (so they bend through curves), each a
// kinematic Rapier body the car can hit. A tram slows and stops for the car
// when it is on the track ahead.

import * as THREE from 'three';
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import { TRAM } from './tramLayout.ts';

type P = [number, number];

/** A route: points every metre along a chain of tracks, with heights. */
interface Route {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  length: number;
}

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

/** Metres behind its centre line that the nose's corners sit (plan rounding). */
const PLAN = 0.6;
const W = 2.3;
const SKIRT_Y = 0.12;
const AW = TRAM.atlas[0], AH = TRAM.atlas[1];
/** The five modules and four bellows, [front, back] in metres from the nose tip. */
const MODULES = [0, 2, 4, 6, 8].map((i) => [TRAM.knots[i], TRAM.knots[i + 1]]);
const BELLOWS = [1, 3, 5, 7].map((i) => [TRAM.knots[i], TRAM.knots[i + 1]]);

type Profile = readonly (readonly number[])[];
/** How far back from the tip the end is at height [y]. */
function rake(profile: Profile, y: number) {
  if (y <= profile[0][0]) return profile[0][1];
  for (let i = 1; i < profile.length; i++) {
    if (y <= profile[i][0]) {
      const [y0, d0] = profile[i - 1], [y1, d1] = profile[i];
      return d0 + ((d1 - d0) * (y - y0)) / (y1 - y0);
    }
  }
  return profile[profile.length - 1][1];
}
/** The nose (or tail) surface: [t] runs -1..1 across, the corners sit PLAN further back. */
const endD = (profile: Profile, t: number, y: number) =>
  rake(profile, y) + PLAN * (1 - Math.pow(1 - Math.pow(Math.abs(t), 2.2), 1 / 2.2));

function sideUV(img: 'side' | 'left', d: number, y: number): [number, number] {
  const k = TRAM.knots, X = TRAM[img].knotX;
  d = Math.max(0, Math.min(TRAM.length, d));
  let i = 0;
  while (i < k.length - 2 && d > k[i + 1]) i++;
  const px = X[i] + ((X[i + 1] - X[i]) * (d - k[i])) / (k[i + 1] - k[i]);
  const L = TRAM[img];
  const py = L.roofRow + ((TRAM.roofY - y) / (TRAM.roofY - TRAM.floorY)) * (L.floorRow - L.roofRow);
  return [px / AW, 1 - py / AH];
}

function endUV(img: 'front' | 'rear', x: number, y: number): [number, number] {
  const L = TRAM[img];
  // Seen from the front the tram's left (+x) is on the right; from behind, its right.
  const u = img === 'front' ? (x + W / 2) / W : (W / 2 - x) / W;
  const py = L.topRow + ((TRAM.frontTopY - y) / (TRAM.frontTopY - TRAM.floorY)) * (L.floorRow - L.topRow);
  return [(L.x0 + u * (L.x1 - L.x0)) / AW, 1 - py / AH];
}

type V = [number, number, number]; // x, y, metres from the nose tip
type Surface = 'body' | 'roof' | 'dark';

/**
 * Collects the triangles of one part (a module or bellows) in its own frame:
 * centred on [dCenter], facing +z. Every face is textured by planar
 * projection from the view it faces: a side view, the front or rear view,
 * or a flat blue (roof) or dark (underside) patch.
 */
class Builder {
  readonly pos: number[] = [];
  readonly uv: number[] = [];
  readonly col: number[] = [];
  private readonly blue = new THREE.Color(TRAM.blue);
  private readonly dCenter: number;
  private readonly ends: { front: boolean; rear: boolean };
  constructor(dCenter: number, ends: { front: boolean; rear: boolean }) {
    this.dCenter = dCenter;
    this.ends = ends;
  }

  quad(a: V, b: V, c: V, d: V, surface: Surface, out: V) {
    this.tri(a, b, c, surface, out);
    this.tri(a, c, d, surface, out);
  }

  /** [out] is a direction (x, y, d) the face should point along, to wind it. */
  tri(a: V, b: V, c: V, surface: Surface, out: V) {
    const p = [a, b, c].map(([x, y, d]) => new THREE.Vector3(x, y, this.dCenter - d));
    const n = p[1].clone().sub(p[0]).cross(p[2].clone().sub(p[0]));
    if (n.lengthSq() < 1e-10) return;
    if (n.x * out[0] + n.y * out[1] - n.z * out[2] < 0) {
      [a, c] = [c, a];
      [p[0], p[2]] = [p[2], p[0]];
      n.negate();
    }
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    const cx = (a[0] + b[0] + c[0]) / 3;
    let uvOf: (v: V) => [number, number];
    let color = [1, 1, 1];
    const patch = (at: readonly number[]) => (): [number, number] => [at[0] / AW, 1 - at[1] / AH];
    if (surface === 'dark' || (ay >= ax && ay >= az && n.y < 0)) {
      uvOf = patch(TRAM.dark);
    } else if (surface === 'roof' || (ay >= ax && ay >= az)) {
      uvOf = patch(TRAM.white);
      color = [this.blue.r, this.blue.g, this.blue.b];
    } else if (ax >= az) {
      // The tram's right side is -x (facing +z).
      const img = cx < 0 ? 'side' : 'left';
      uvOf = (v) => sideUV(img, v[2], v[1]);
    } else if (n.z > 0 && this.ends.front) {
      uvOf = (v) => endUV('front', v[0], v[1]);
    } else if (n.z < 0 && this.ends.rear) {
      uvOf = (v) => endUV('rear', v[0], v[1]);
    } else {
      uvOf = patch(TRAM.dark);
    }
    for (let i = 0; i < 3; i++) {
      this.pos.push(p[i].x, p[i].y, p[i].z);
      this.uv.push(...uvOf([a, b, c][i]));
      this.col.push(...color);
    }
  }

  /** An axis-aligned box, [x0..x1] x [y0..y1] x [d0..d1]. */
  box(x0: number, x1: number, y0: number, y1: number, d0: number, d1: number, surface: Surface) {
    const xc = (x0 + x1) / 2, yc = (y0 + y1) / 2, dc = (d0 + d1) / 2;
    this.quad([x0, y1, d0], [x1, y1, d0], [x1, y1, d1], [x0, y1, d1], surface, [0, 1, 0]);
    this.quad([x0, y0, d0], [x0, y1, d0], [x0, y1, d1], [x0, y0, d1], surface, [x0 - xc, 0, 0]);
    this.quad([x1, y0, d0], [x1, y1, d0], [x1, y1, d1], [x1, y0, d1], surface, [x1 - xc, 0, 0]);
    this.quad([x0, y0, d0], [x1, y0, d0], [x1, y1, d0], [x0, y1, d0], surface, [0, 0, d0 - dc]);
    this.quad([x0, y0, d1], [x1, y0, d1], [x1, y1, d1], [x0, y1, d1], surface, [0, 0, d1 - dc]);
    void yc;
  }

  /** A thin bar from [a] to [b] (a pantograph arm), [r] half thick. */
  bar(a: V, b: V, r: number) {
    const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const side = new THREE.Vector3(1, 0, 0);
    if (Math.abs(dir.clone().normalize().x) > 0.9) side.set(0, 1, 0);
    const u = dir.clone().cross(side).normalize().multiplyScalar(r);
    const w = dir.clone().cross(u).normalize().multiplyScalar(r);
    const at = (p: V, su: number, sw: number): V => [p[0] + u.x * su + w.x * sw, p[1] + u.y * su + w.y * sw, p[2] + u.z * su + w.z * sw];
    const corners: [number, number][] = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    for (let i = 0; i < 4; i++) {
      const [s0, w0] = corners[i], [s1, w1] = corners[(i + 1) % 4];
      const o: V = [u.x * (s0 + s1) + w.x * (w0 + w1), u.y * (s0 + s1) + w.y * (w0 + w1), u.z * (s0 + s1) + w.z * (w0 + w1)];
      this.quad(at(a, s0, w0), at(b, s0, w0), at(b, s1, w1), at(a, s1, w1), 'dark', o);
    }
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    return g;
  }
}

/**
 * One module of the ZET TMK 2200, [d0..d1] metres from the nose tip, textured
 * from the generated side, front and rear views (tool/prepare_tram.py). The
 * first module carries the raked cab nose and the pantograph, the last one
 * the tail.
 */
function moduleGeometry(d0: number, d1: number) {
  const nose = d0 === 0, tail = d1 === TRAM.length;
  const b = new Builder((d0 + d1) / 2, { front: nose, rear: tail });
  const ys = TRAM.noseProfile.map((p) => p[0]);
  const top = TRAM.roofY, floor = TRAM.floorY;
  const frontD = (t: number, y: number) => (nose ? endD(TRAM.noseProfile, t, y) : d0);
  const backD = (t: number, y: number) => (tail ? TRAM.length - endD(TRAM.tailProfile, t, y) : d1);
  // Sides, row by row so they follow the raked ends; the rows below the floor
  // carry the bogie skirts (cut out by the texture's alpha).
  const levels = [SKIRT_Y, ...ys];
  for (const sx of [-1, 1]) {
    const x = (sx * W) / 2;
    for (let j = 0; j + 1 < levels.length; j++) {
      const ya = levels[j], yb = levels[j + 1];
      const fa = frontD(1, Math.max(ya, floor)), fb = frontD(1, yb);
      const ba = backD(1, Math.max(ya, floor)), bb = backD(1, yb);
      b.quad([x, ya, fa], [x, ya, ba], [x, yb, bb], [x, yb, fb], 'body', [sx, 0, 0]);
    }
  }
  // Roof and underside, column by column so they meet the curved ends.
  const N = 16;
  const ts = Array.from({ length: N + 1 }, (_, i) => -1 + (2 * i) / N);
  for (let i = 0; i < N; i++) {
    const [t0, t1] = [ts[i], ts[i + 1]];
    const [x0, x1] = [(t0 * W) / 2, (t1 * W) / 2];
    b.quad([x0, top, frontD(t0, top)], [x1, top, frontD(t1, top)], [x1, top, backD(t1, top)], [x0, top, backD(t0, top)], 'roof', [0, 1, 0]);
    b.quad([x0, floor, frontD(t0, floor)], [x1, floor, frontD(t1, floor)], [x1, floor, backD(t1, floor)], [x0, floor, backD(t0, floor)], 'dark', [0, -1, 0]);
  }
  // The raked ends: a grid over (across, height).
  for (const [on, dOf, dir] of [
    [nose, (t: number, y: number) => endD(TRAM.noseProfile, t, y), -1],
    [tail, (t: number, y: number) => TRAM.length - endD(TRAM.tailProfile, t, y), 1],
  ] as const) {
    if (!on) continue;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j + 1 < ys.length; j++) {
        const [t0, t1] = [ts[i], ts[i + 1]], [ya, yb] = [ys[j], ys[j + 1]];
        const v = (t: number, y: number): V => [(t * W) / 2, y, dOf(t, y)];
        b.quad(v(t0, ya), v(t1, ya), v(t1, yb), v(t0, yb), 'body', [(t0 + t1) / 2, 0, dir]);
      }
    }
  }
  // Flat ends against the bellows.
  if (!nose) b.quad([-W / 2, floor, d0], [W / 2, floor, d0], [W / 2, top, d0], [-W / 2, top, d0], 'dark', [0, 0, -1]);
  if (!tail) b.quad([-W / 2, floor, d1], [W / 2, floor, d1], [W / 2, top, d1], [-W / 2, top, d1], 'dark', [0, 0, 1]);
  // Roof equipment covers along the flat part of the roof.
  const r0 = frontD(1, top) + 0.3, r1 = backD(1, top) - 0.3;
  if (nose) {
    b.box(-0.8, 0.8, top, top + 0.26, r0 + 2.6, r1, 'roof');
    // Single-arm pantograph, raised a little, just behind the cab.
    const base = r0 + 1.6;
    b.box(-0.55, 0.55, top, top + 0.12, base - 0.6, base + 0.6, 'dark');
    for (const x of [-0.25, 0.25]) {
      b.bar([x, top + 0.15, base + 0.4], [x * 0.3, top + 0.75, base - 0.9], 0.035);
      b.bar([x * 0.3, top + 0.75, base - 0.9], [0, top + 1.25, base + 0.1], 0.03);
    }
    b.box(-0.8, 0.8, top + 1.22, top + 1.3, base, base + 0.2, 'dark');
  } else {
    b.box(-0.8, 0.8, top, top + 0.26, r0, r1, 'roof');
  }
  return b.geometry();
}

/** The rubber bellows between two modules, [d0..d1] metres from the nose tip. */
function bellowsGeometry(d0: number, d1: number) {
  const b = new Builder((d0 + d1) / 2, { front: false, rear: false });
  const x = W / 2 - 0.06;
  for (const sx of [-1, 1]) {
    b.quad([sx * x, TRAM.floorY, d0], [sx * x, TRAM.floorY, d1], [sx * x, TRAM.roofY, d1], [sx * x, TRAM.roofY, d0], 'body', [sx, 0, 0]);
  }
  b.quad([-x, TRAM.roofY, d0], [x, TRAM.roofY, d0], [x, TRAM.roofY, d1], [-x, TRAM.roofY, d1], 'dark', [0, 1, 0]);
  return b.geometry();
}

interface Tram {
  route: Route;
  s: number; // the nose tip, metres along the route
  prevS: number;
  speed: number;
  meshes: THREE.Mesh[]; // modules, then bellows
  bodies: RAPIER_NS.RigidBody[]; // modules
}

/** Where each mesh rides: its two track points, metres behind the nose tip. */
const PARTS = [
  ...MODULES.map(([d0, d1]) => [d0 + 1, d1 - 1]),
  ...BELLOWS.map(([d0, d1]) => [(d0 + d1) / 2 - 1, (d0 + d1) / 2 + 1]),
];

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
    const atlas = new THREE.TextureLoader().load('models/tram_atlas.png');
    atlas.colorSpace = THREE.SRGBColorSpace;
    atlas.anisotropy = 8;
    const material = new THREE.MeshStandardMaterial({
      map: atlas,
      vertexColors: true,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      roughness: 0.35,
      metalness: 0.1,
    });
    const geos = [...MODULES.map(([a, b]) => moduleGeometry(a, b)), ...BELLOWS.map(([a, b]) => bellowsGeometry(a, b))];
    const routes = chain(lines)
      .map((c) => resample(c, inside, height))
      .filter((r): r is Route => !!r && r.length > 120);
    for (const route of routes) {
      // One tram per ~400 m of route, spread out.
      const count = Math.max(1, Math.floor(route.length / 400));
      for (let k = 0; k < count; k++) {
        const meshes = geos.map((g) => {
          const mesh = new THREE.Mesh(g, material);
          mesh.castShadow = mesh.receiveShadow = true;
          this.root.add(mesh);
          return mesh;
        });
        const bodies = MODULES.map(([d0, d1]) => {
          const body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
          world.createCollider(R.ColliderDesc.cuboid(1.15, 1.45, (d1 - d0) / 2).setTranslation(0, 1.75, 0), body);
          return body;
        });
        const s = TRAM.length + ((route.length - TRAM.length) * (k + 0.3)) / count;
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
    // What every tram occupies: points every 2 m along its body, and the
    // 10 m of track just ahead of its nose (where it is about to go).
    this.trams.forEach((t, k) => {
      const pts = (this.bodyPts[k] ??= Array.from({ length: Math.ceil(TRAM.length / 2) + 1 }, () => new THREE.Vector3()));
      pts.forEach((p, i) => sample(t.route, t.s - Math.min(i * 2, TRAM.length), p));
      const next = (this.nextPts[k] ??= Array.from({ length: 6 }, () => new THREE.Vector3()));
      next.forEach((p, i) => sample(t.route, t.s + 2 + i * 2, p));
    });
    const near = (p: THREE.Vector3, pts: THREE.Vector3[]) => pts.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 2 && Math.abs(q.y - p.y) < 3);
    this.trams.forEach((t, k) => {
      t.prevS = t.s;
      // Something on the rails ahead, within braking distance? Slow to a
      // stop a few metres short of it. Walking this tram's own track catches
      // trams in front on curves and at crossings, and never the one passing
      // on the parallel track back the other way.
      let target = CRUISE;
      const nose = t.route.length > t.s ? sample(t.route, t.s, this.tmpA) : this.tmpA.set(1e9, 0, 1e9);
      const others = this.trams
        .map((_, u) => u)
        .filter((u) => u !== k && this.bodyPts[u][0].distanceTo(nose) < 90);
      for (let d = 0; d <= 45; d += 1) {
        if (t.s + d > t.route.length) break;
        const p = sample(t.route, t.s + d, this.tmpB);
        // The car on the rails, or another tram's body; at a crossing also the
        // track a tram with a lower index is about to take (so two trams
        // arriving together never wait for each other).
        const car2 = Math.hypot(car.x - p.x, car.z - p.z) < 2.6 && Math.abs(car.y - p.y) < 3 && d < 28;
        if (car2 || others.some((u) => near(p, this.bodyPts[u]) || (u < k && near(p, this.nextPts[u])))) {
          target = Math.max(0, (d - 6) * 0.45);
          break;
        }
      }
      const accel = target < t.speed ? 3.2 : 1.1;
      t.speed += Math.max(-accel * dt, Math.min(accel * dt, target - t.speed));
      t.s += t.speed * dt;
      if (t.s > t.route.length) {
        // Leave the city at the far end and come back in at the start, but
        // only once the start of the track is clear; until then wait.
        let blocked = false;
        for (let d = 0; d < TRAM.length + 15 && !blocked; d += 2) {
          const p = sample(t.route, d, this.tmpB);
          blocked = this.bodyPts.some((pts, u) => u !== k && near(p, pts));
        }
        if (blocked) {
          t.s = t.route.length;
          t.speed = 0;
        } else {
          t.s = TRAM.length;
          t.prevS = t.s;
        }
      }
    });
    this.syncBodies(false);
  }

  private readonly bodyPts: THREE.Vector3[][] = [];
  private readonly nextPts: THREE.Vector3[][] = [];

  /** Part [i] (PARTS) rides on two track points, like a body on its bogies. */
  private partPose(t: Tram, s: number, i: number, pos: THREE.Vector3, quat: THREE.Quaternion) {
    const a = sample(t.route, s - PARTS[i][0], this.tmpA);
    const b = sample(t.route, s - PARTS[i][1], this.tmpB);
    pos.copy(a).add(b).multiplyScalar(0.5);
    const yaw = Math.atan2(a.x - b.x, a.z - b.z);
    const pitch = -Math.atan2(a.y - b.y, Math.hypot(a.x - b.x, a.z - b.z));
    quat.setFromEuler(this.euler.set(pitch, yaw, 0, 'YXZ'));
  }

  private readonly euler = new THREE.Euler();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();

  private syncBodies(teleport: boolean) {
    for (const t of this.trams) {
      t.bodies.forEach((body, i) => {
        this.partPose(t, t.s, i, this.pos, this.quat);
        if (teleport) {
          body.setTranslation(this.pos, true);
          body.setRotation(this.quat, true);
        } else {
          body.setNextKinematicTranslation(this.pos);
          body.setNextKinematicRotation(this.quat);
        }
      });
    }
  }

  /** Poses the meshes between the last two steps. */
  place(alpha: number) {
    for (const t of this.trams) {
      const jumped = t.s < t.prevS;
      const s = jumped ? t.s : t.prevS + (t.s - t.prevS) * alpha;
      t.meshes.forEach((mesh, i) => {
        this.partPose(t, s, i, this.pos, this.quat);
        mesh.position.copy(this.pos);
        mesh.quaternion.copy(this.quat);
      });
    }
  }
}
