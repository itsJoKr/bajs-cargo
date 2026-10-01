// ZET trams on the real tracks: the OSM tram ways are chained into long
// routes, and five-module ZET TMK 2200 low-floor trams run along them, each
// module following the rails on its own (so they bend through curves), each a
// kinematic Rapier body the car can hit. A tram slows and stops for the car
// or a tram on the track ahead, and takes turns at junctions (merges and
// crossings) with trams on routes that foul its own.

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
  /** The junctions it passes, in order along it. */
  gates: Gate[];
}

/** Where routes merge or cross. A tram may only enter while no tram of a
 * route that fouls its own there holds it (so two trams never both nose into
 * a merge and wait for each other forever). */
interface Junction {
  holders: Set<Tram>;
  fouls: Map<Route, Set<Route>>;
}

/** A junction on one route: [enter] is where a tram without the right of way
 * stops, [exit] where its tail clears the last fouling point. */
interface Gate {
  junction: Junction;
  enter: number;
  exit: number;
}

const CRUISE = 9; // m/s, about 32 km/h
/** Centre lines closer than this share track space (2.3 m wide trams; the
 * two tracks of a street run 2.6-5 m apart). */
const FOUL = 2;
/** How far before its first fouling point a tram waits for the right of way. */
const GATE = 12;
/** How far ahead a tram claims the junctions it is coming to. */
const LOOK = 40;

/** Every way through the network: track ways that meet end to start, joined
 * into chains that take every branch at a switch (so ways are shared between
 * routes, and no route stops at a junction because another one took the way on). */
function chains(lines: P[][]): P[][] {
  const key = (p: P) => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;
  const heading = (a: P, b: P) => Math.atan2(b[1] - a[1], b[0] - a[0]);
  const starts = new Map<string, number[]>();
  lines.forEach((l, i) => {
    const k = key(l[0]);
    starts.set(k, [...(starts.get(k) ?? []), i]);
  });
  const ends = new Set(lines.map((l) => key(l[l.length - 1])));
  const walked = new Set<number>();
  const out: P[][] = [];
  const walk = (path: number[]) => {
    if (out.length >= 64) return;
    const last = lines[path[path.length - 1]];
    const tail = last[last.length - 1], dir = heading(last[last.length - 2], tail);
    const next = (starts.get(key(tail)) ?? []).filter((j) => {
      const d = heading(lines[j][0], lines[j][1]) - dir;
      return !path.includes(j) && Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) < 0.9;
    });
    if (next.length) {
      for (const j of next) walk([...path, j]);
      return;
    }
    path.forEach((i) => walked.add(i));
    out.push(path.flatMap((i, n) => (n ? lines[i].slice(1) : lines[i])));
  };
  // Start where nothing leads in, then pick up the loops.
  for (const i of lines.keys()) if (!ends.has(key(lines[i][0]))) walk([i]);
  for (const i of lines.keys()) if (!walked.has(i)) walk([i]);
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
  const route: Route = { x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n), length: n - 1, gates: [] };
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

/** Finds where routes foul each other (closer than FOUL, other than running
 * along the same track the same way) and gives every route its gates. */
function junctions(routes: Route[]) {
  const cellOf = (x: number, z: number, size: number) => `${Math.floor(x / size)},${Math.floor(z / size)}`;
  const grid = new Map<string, [number, number][]>();
  routes.forEach((r, a) => {
    for (let i = 0; i <= r.length; i++) {
      const c = cellOf(r.x[i], r.z[i], FOUL);
      grid.set(c, [...(grid.get(c) ?? []), [a, i]]);
    }
  });
  const dir = (r: Route, i: number) => {
    const h = Math.max(i - 1, 0), j = Math.min(i + 1, r.length);
    return Math.atan2(r.z[j] - r.z[h], r.x[j] - r.x[h]);
  };
  const points: { a: number; b: number; s: number; x: number; z: number }[] = [];
  routes.forEach((r, a) => {
    for (let i = 0; i <= r.length; i++) {
      const fouled = new Set<number>(), same = new Set<number>();
      const cx = Math.floor(r.x[i] / FOUL), cz = Math.floor(r.z[i] / FOUL);
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++)
          for (const [b, j] of grid.get(`${cx + dx},${cz + dz}`) ?? []) {
            if (b === a) continue;
            const q = routes[b];
            const d = Math.hypot(q.x[j] - r.x[i], q.z[j] - r.z[i]);
            if (d >= FOUL) continue;
            const turn = dir(q, j) - dir(r, i);
            if (d < 0.7 && Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))) < 0.35) same.add(b);
            else fouled.add(b);
          }
      for (const b of fouled) if (!same.has(b)) points.push({ a, b, s: i, x: r.x[i], z: r.z[i] });
    }
  });
  // Fouling points within 30 m of each other make one junction.
  const parent = points.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const cells = new Map<string, number[]>();
  points.forEach((p, i) => {
    const c = cellOf(p.x, p.z, 30);
    cells.set(c, [...(cells.get(c) ?? []), i]);
  });
  points.forEach((p, i) => {
    const cx = Math.floor(p.x / 30), cz = Math.floor(p.z / 30);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        for (const j of cells.get(`${cx + dx},${cz + dz}`) ?? [])
          if (Math.hypot(points[j].x - p.x, points[j].z - p.z) < 30) parent[root(i)] = root(j);
  });
  const groups = new Map<number, typeof points>();
  points.forEach((p, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), p]));
  for (const group of groups.values()) {
    const junction: Junction = { holders: new Set(), fouls: new Map() };
    const span = new Map<Route, [number, number]>();
    for (const { a, b, s } of group) {
      const ra = routes[a], rb = routes[b];
      if (!junction.fouls.has(ra)) junction.fouls.set(ra, new Set());
      junction.fouls.get(ra)!.add(rb);
      const [s0, s1] = span.get(ra) ?? [s, s];
      span.set(ra, [Math.min(s0, s), Math.max(s1, s)]);
    }
    for (const [r, [s0, s1]] of span) r.gates.push({ junction, enter: s0 - GATE, exit: s1 + 2 });
  }
  for (const r of routes) r.gates.sort((g, h) => g.enter - h.enter);
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
  /** Off the map: it ran off the end of its route and waits for the start to clear. */
  hidden: boolean;
  /** Moved in one jump (left or came back): the bodies teleport, not sweep. */
  jumped: boolean;
  /** Seconds it has waited at a junction (the longest waiting goes first). */
  wait: number;
  /** Held up by the car or another tram (not a junction gate): it rings its bell. */
  blocked: boolean;
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
    spacing = 400, // metres of route per tram
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
    const local = lines.filter((l) => l.some(([x, z]) => inside(x, z)));
    const routes = chains(local)
      .map((c) => resample(c, inside, height))
      .filter((r): r is Route => !!r && r.length > 120);
    junctions(routes);
    const placed: THREE.Vector3[] = [];
    for (const route of routes) {
      // One tram per [spacing] of route, spread out.
      const count = Math.max(1, Math.floor(route.length / spacing));
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
        // Routes share track: one that would start on top of another tram
        // starts off the map instead.
        const pts = Array.from({ length: Math.ceil(TRAM.length / 2) + 1 }, (_, i) => sample(route, s - i * 2, new THREE.Vector3()));
        const hidden = pts.some((p) => placed.some((q) => p.distanceTo(q) < 4));
        if (!hidden) placed.push(...pts);
        this.trams.push({ route, s, prevS: s, speed: CRUISE, hidden, jumped: true, wait: 0, blocked: false, meshes, bodies });
      }
    }
    this.place(1);
    this.syncBodies(true);
  }

  get count() {
    return this.trams.length;
  }

  /** Pushes what the trams occupy (every 2 m of each body) and the track just ahead
   * of each nose, as [x, z] pairs, for pedestrians to keep off. */
  hazards(push: (x: number, z: number) => void) {
    this.trams.forEach((t, k) => {
      if (t.hidden || !this.bodyPts[k] || !this.nextPts[k]) return;
      for (const p of this.bodyPts[k]) push(p.x, p.z);
      for (const p of this.nextPts[k]) push(p.x, p.z);
    });
  }

  /** Where each tram on the map is (its middle) and how fast it goes, for the sound. */
  audioSources(): { id: number; x: number; y: number; z: number; speed: number; blocked: boolean }[] {
    const out: { id: number; x: number; y: number; z: number; speed: number; blocked: boolean }[] = [];
    this.trams.forEach((t, k) => {
      const pts = this.bodyPts[k];
      if (t.hidden || !pts) return;
      const p = pts[pts.length >> 1];
      out.push({ id: k, x: p.x, y: p.y, z: p.z, speed: t.speed, blocked: t.blocked });
    });
    return out;
  }

  /** One physics step. [car] is the car's position, to stop for it. */
  step(dt: number, car: THREE.Vector3) {
    // What every tram occupies: points every 2 m along its body, and the
    // 10 m of track just ahead of its nose (where it is about to go).
    this.trams.forEach((t, k) => {
      const pts = (this.bodyPts[k] ??= Array.from({ length: Math.ceil(TRAM.length / 2) + 1 }, () => new THREE.Vector3()));
      const next = (this.nextPts[k] ??= Array.from({ length: 6 }, () => new THREE.Vector3()));
      if (t.hidden) {
        for (const p of [...pts, ...next]) p.set(1e9, 0, 1e9);
        return;
      }
      pts.forEach((p, i) => sample(t.route, t.s - Math.min(i * 2, TRAM.length), p));
      next.forEach((p, i) => sample(t.route, t.s + 2 + i * 2, p));
    });
    const near = (p: THREE.Vector3, pts: THREE.Vector3[]) => pts.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 2 && Math.abs(q.y - p.y) < 3);

    // Right of way at junctions, the longest waiting first: claim each
    // junction coming up unless a tram from a fouling route holds it or
    // already waits for it, and hold it until the tail is clear; without it,
    // wait before it.
    const waitAt = new Map<Tram, number>();
    const queued = new Map<Junction, Tram[]>();
    for (const t of [...this.trams].sort((a, b) => b.wait - a.wait)) {
      if (t.hidden) continue;
      for (const g of t.route.gates) {
        const { holders, fouls } = g.junction;
        if (t.s - TRAM.length > g.exit) {
          holders.delete(t);
          continue;
        }
        if (holders.has(t)) continue;
        if (t.s + LOOK < g.enter) break;
        const foul = fouls.get(t.route)!;
        // (Already past the gate, say placed there at the start: go on.)
        const ahead = [...holders, ...(queued.get(g.junction) ?? [])];
        if (t.s < g.enter && ahead.some((u) => foul.has(u.route))) {
          waitAt.set(t, g.enter);
          queued.set(g.junction, [...(queued.get(g.junction) ?? []), t]);
          break;
        }
        holders.add(t);
      }
    }

    this.trams.forEach((t, k) => {
      t.prevS = t.s;
      if (t.hidden) {
        // Come back in at the start once it is clear.
        let blocked = false;
        for (let d = 0; d < TRAM.length + 30 && !blocked; d += 2) {
          const p = sample(t.route, d, this.tmpB);
          blocked = this.bodyPts.some((pts, u) => u !== k && near(p, pts));
        }
        if (!blocked) {
          t.hidden = false;
          t.jumped = true;
          t.s = t.prevS = TRAM.length;
          t.speed = CRUISE;
          // (Occupied at once, for the next tram waiting at the same start.)
          this.bodyPts[k].forEach((p, i) => sample(t.route, t.s - Math.min(i * 2, TRAM.length), p));
        }
        return;
      }
      // Something on the rails ahead, within braking distance? Slow to a
      // stop a few metres short of it. Walking this tram's own track catches
      // trams in front on curves, and never the one passing on the parallel
      // track back the other way.
      let target = CRUISE;
      t.blocked = false;
      const nose = sample(t.route, t.s, this.tmpA);
      const others = this.trams
        .map((_, u) => u)
        .filter((u) => u !== k && this.bodyPts[u][0].distanceTo(nose) < 90);
      for (let d = 0; d <= 45; d += 1) {
        if (t.s + d > t.route.length) break;
        const p = sample(t.route, t.s + d, this.tmpB);
        const car2 = Math.hypot(car.x - p.x, car.z - p.z) < 2.6 && Math.abs(car.y - p.y) < 3 && d < 28;
        if (car2 || others.some((u) => near(p, this.bodyPts[u]))) {
          target = Math.min(CRUISE, Math.max(0, (d - 6) * 0.45));
          t.blocked = true;
          break;
        }
      }
      const gate = waitAt.get(t);
      if (gate !== undefined) target = Math.min(target, Math.max(0, (gate - t.s - 2) * 0.45));
      t.wait = gate !== undefined ? t.wait + dt : 0;
      const accel = target < t.speed ? 3.2 : 1.1;
      t.speed += Math.max(-accel * dt, Math.min(accel * dt, target - t.speed));
      t.s += t.speed * dt;
      if (t.s > t.route.length) {
        // Leave the city at the far end.
        t.hidden = t.jumped = true;
        for (const g of t.route.gates) g.junction.holders.delete(t);
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
    this.trams.forEach((t, k) => {
      const jump = teleport || t.jumped;
      t.jumped = false;
      t.bodies.forEach((body, i) => {
        this.partPose(t, t.s, i, this.pos, this.quat);
        // Off the map: parked far under the city, apart.
        if (t.hidden) this.pos.set(k * 50, -1000 - i * 10, 0);
        if (jump) {
          body.setTranslation(this.pos, true);
          body.setRotation(this.quat, true);
        } else {
          body.setNextKinematicTranslation(this.pos);
          body.setNextKinematicRotation(this.quat);
        }
      });
    });
  }

  /** Poses the meshes between the last two steps. */
  place(alpha: number) {
    for (const t of this.trams) {
      for (const mesh of t.meshes) mesh.visible = !t.hidden;
      if (t.hidden) continue;
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
