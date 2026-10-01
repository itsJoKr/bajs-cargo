// The tram overhead: contact wires over every track, masts beside them and span wires.
//
// Zagreb's trams run under two contact wires per track, hung from cross-arms on
// white tubular masts (about every 30 m; on the median between two tracks when
// they are far enough apart) and from span wires that end in rosettes on the
// facades across the street. Hanging opal globe lamps and yellow speed plates
// hang on the spans at the street mouths.
//
// Everything is built once at load from city.json `trams` (web frame):
//  - wires, hangers and span wires are camera-facing ribbons (a vertex shader
//    keeps them at least ~1.5 px wide, so they stay visible at 100+ m), merged
//    into one BufferGeometry per 128 m tile;
//  - masts, cross-arms, globes, speed plates and rosettes are InstancedMeshes;
//  - each mast is a thin static Rapier cylinder (the car hits it, the crowd
//    walks around it).
// The pantograph of trams.ts reaches 3.05 + 1.3 m above the rail: the contact
// wire hangs just over it (CONTACT_H) and trams pass under without touching.

import * as THREE from 'three';
import type RAPIER_NS from '@dimforge/rapier3d-compat';

type P = [number, number];

/** Contact wire height over the rail: the pantograph's collector top is at 4.35 (trams.ts). */
const CONTACT_H = 4.42;
const MAST_H = 8.9;
/** The cross-arm that carries the hangers, and the span wire attachment. */
const ARM_Y = 5.6;
const SPAN_Y = 7.4;
const SAMPLE = 2; // m between samples along a track
const MAST_SPACING = 30;
const MIN_MAST_GAP = 18;
const TILE = 128;
const WIRE_R = 0.012;
/** Streets the survey found hung with globe lamps and speed plates: [x, z, radius]. */
const MOUTHS: [number, number, number][] = [
  [39, 50, 26], // Praška
  [110, 46, 22], // Jurišićeva
  [-86, 2, 22], // Ilica
];

interface Sample {
  x: number;
  y: number;
  z: number;
  tx: number;
  tz: number;
  run: number;
  /** Metres along its run (the zig-zag phase). */
  arc: number;
}
interface Run {
  id: number;
  s: Sample[];
}
interface Mast {
  x: number;
  y: number;
  z: number;
  /** Cross directions (unit, flat) and the arm length to reach the far track. */
  arms: { ux: number; uz: number; len: number; tracks: number[] }[];
  /** The tracks (sample refs) it carries, for the hangers. */
  covers: Sample[];
}
type Seg = [number, number, number, number, number, number];

const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** The wire shader: a ribbon between [position] and [aOther], at least uMinPx wide on screen. */
function ribbonMaterial() {
  const uniforms = { uPx: { value: 0.002 }, uMinPx: { value: 1.5 }, uRadius: { value: WIRE_R } };
  const material = new THREE.MeshBasicMaterial({ color: 0x2c2e31, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aOther;
        attribute float aSide;
        uniform float uPx;
        uniform float uMinPx;
        uniform float uRadius;`,
      )
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
        vec4 mvOther = modelViewMatrix * vec4(aOther, 1.0);
        vec2 wd = mvOther.xy - mvPosition.xy;
        float wl = length(wd);
        wd = wl > 1e-5 ? wd / wl : vec2(1.0, 0.0);
        float depth = max(-mvPosition.z, 0.5);
        float halfW = max(uRadius, uPx * depth * 0.5 * uMinPx);
        mvPosition.xy += vec2(-wd.y, wd.x) * aSide * halfW;
        gl_Position = projectionMatrix * mvPosition;`,
      );
  };
  return { material, uniforms };
}

/** Collects ribbon segments and emits one mesh per tile. */
class Ribbons {
  private readonly tiles = new Map<string, Seg[]>();
  count = 0;
  add(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
    const key = `${Math.floor((ax + bx) / 2 / TILE)},${Math.floor((az + bz) / 2 / TILE)}`;
    let list = this.tiles.get(key);
    if (!list) this.tiles.set(key, (list = []));
    list.push([ax, ay, az, bx, by, bz]);
    this.count++;
  }
  /** A polyline of points (flat xyz triples). */
  line(pts: number[]) {
    for (let i = 3; i < pts.length; i += 3) this.add(pts[i - 3], pts[i - 2], pts[i - 1], pts[i], pts[i + 1], pts[i + 2]);
  }
  build(material: THREE.Material, onBefore: (r: THREE.WebGLRenderer, c: THREE.Camera) => void, root: THREE.Group) {
    let draws = 0, tris = 0;
    for (const [key, segs] of this.tiles) {
      const n = segs.length;
      const pos = new Float32Array(n * 12), other = new Float32Array(n * 12), side = new Float32Array(n * 4);
      const idx = new Uint32Array(n * 6);
      segs.forEach((s, i) => {
        const v = i * 4;
        // A+, A-, B(-), B(+): B faces the other way so its side flips.
        const ends = [0, 0, 1, 1], sgn = [1, -1, -1, 1];
        for (let k = 0; k < 4; k++) {
          const a = ends[k] === 0 ? 0 : 3, b = ends[k] === 0 ? 3 : 0;
          pos.set([s[a], s[a + 1], s[a + 2]], (v + k) * 3);
          other.set([s[b], s[b + 1], s[b + 2]], (v + k) * 3);
          side[v + k] = sgn[k];
        }
        idx.set([v, v + 1, v + 3, v, v + 3, v + 2], i * 6);
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aOther', new THREE.BufferAttribute(other, 3));
      g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      g.boundingSphere!.radius += 1;
      const mesh = new THREE.Mesh(g, material);
      mesh.name = `wires_${key}`;
      mesh.onBeforeRender = (r, _s, c) => onBefore(r, c);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      root.add(mesh);
      draws++;
      tris += n * 2;
    }
    return { draws, tris };
  }
}

export class Catenary {
  readonly root = new THREE.Group();

  /** [lines] are city.json `trams`: polylines [x, z] (web frame); [groundAt] the ground height. */
  readonly lines: [number, number][][];
  readonly groundAt: (x: number, z: number) => number;
  /** What was built (also logged). */
  /** Mast positions [x, z] (debug). */
  mastPos: number[][] = [];
  readonly stats = { masts: 0, wireMetres: 0, triangles: 0, drawCalls: 0, spans: 0, globes: 0, plates: 0, colliders: 0 };

  constructor(
    lines: [number, number][][],
    groundAt: (x: number, z: number) => number,
    R?: typeof RAPIER_NS,
    world?: RAPIER_NS.World,
    data?: { extent: number[]; blocked?: number[][] },
  ) {
    this.lines = lines;
    this.groundAt = groundAt;
    this.root.name = 'catenary';
    const t0 = performance.now();

    // ---- what the world offers -------------------------------------------------
    const extent = data?.extent ?? [-1e9, -1e9, 1e9, 1e9];
    const blocked = data?.blocked ?? [];
    const inside = (x: number, z: number, m: number) =>
      x > extent[0] + m && x < extent[2] - m && z > extent[1] + m && z < extent[3] - m &&
      !blocked.some((b) => x > b[0] - m && x < b[2] + m && z > b[1] - m && z < b[3] + m);
    const fixedOnly = R ? R.QueryFilterFlags.EXCLUDE_DYNAMIC | R.QueryFilterFlags.EXCLUDE_KINEMATIC : 0;
    /** First static surface under (x, z), from [from] down (trams, chairs excluded). */
    const surface = (x: number, z: number, from = 300): number | null => {
      if (!world || !R) return groundAt(x, z);
      const hit = world.castRay(new R.Ray({ x, y: from, z }, { x: 0, y: -1, z: 0 }), from + 50, true, fixedOnly);
      return hit ? from - hit.timeOfImpact : null;
    };

    // ---- 1. track samples, ordered by line length, duplicates dropped ------------
    const order = lines.map((_, i) => i).sort((a, b) => lineLength(lines[b]) - lineLength(lines[a]));
    const cell = 1.6;
    const grid = new Map<string, Sample[]>();
    const gkey = (x: number, z: number) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
    const runs: Run[] = [];
    for (const li of order) {
      const pts = resample(lines[li], SAMPLE, (x, z) => inside(x, z, 6));
      for (const seg of pts) {
        if (seg.length < 3) continue;
        // Heights: the static surface at the rails, median then mean (the trams smooth the same way).
        const raw = seg.map(([x, z]) => surface(x, z) ?? 0);
        const med = raw.map((_, i) => median(raw.slice(Math.max(0, i - 3), i + 4)));
        const y = med.map((_, i) => mean(med.slice(Math.max(0, i - 2), i + 3)));
        const samples: Sample[] = seg.map(([x, z], i) => {
          const a = seg[Math.max(0, i - 1)], b = seg[Math.min(seg.length - 1, i + 1)];
          const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          return { x, y: y[i], z, tx: (b[0] - a[0]) / l, tz: (b[1] - a[1]) / l, run: -1, arc: 0 };
        });
        // Drop what another line already covers (same place, same direction).
        const dup = samples.map((s) => {
          const cx = Math.floor(s.x / cell), cz = Math.floor(s.z / cell);
          for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
              for (const o of grid.get(`${cx + dx},${cz + dz}`) ?? []) {
                if (Math.hypot(o.x - s.x, o.z - s.z) < 1.5 && Math.abs(o.tx * s.tx + o.tz * s.tz) > 0.85) return true;
              }
            }
          }
          return false;
        });
        // Runs of kept samples, each stretched by one covered sample so they still join.
        let i = 0;
        while (i < samples.length) {
          if (dup[i]) {
            i++;
            continue;
          }
          let j = i;
          while (j + 1 < samples.length && !dup[j + 1]) j++;
          const a = Math.max(0, i - 1), b = Math.min(samples.length - 1, j + 1);
          const run: Run = { id: runs.length, s: samples.slice(a, b + 1).map((s) => ({ ...s })) };
          for (const s of run.s) s.run = run.id;
          if (run.s.length >= 3) runs.push(run);
          i = j + 1;
        }
        samples.forEach((s, si) => {
          if (dup[si]) return;
          const k = gkey(s.x, s.z);
          const l = grid.get(k);
          l ? l.push(s) : grid.set(k, [s]);
        });
      }
    }
    // The pair/clearance queries (8 m cells) over the kept samples only.
    const cell2 = 8;
    const hash2 = new Map<string, Sample[]>();
    for (const r of runs) {
      for (const s of r.s) {
        const k = `${Math.floor(s.x / cell2)},${Math.floor(s.z / cell2)}`;
        const l = hash2.get(k);
        l ? l.push(s) : hash2.set(k, [s]);
      }
    }
    const near = (x: number, z: number, r: number) => {
      const out: Sample[] = [];
      const cx = Math.floor(x / cell2), cz = Math.floor(z / cell2), n = Math.ceil(r / cell2);
      for (let dx = -n; dx <= n; dx++) for (let dz = -n; dz <= n; dz++) for (const s of hash2.get(`${cx + dx},${cz + dz}`) ?? []) if (Math.hypot(s.x - x, s.z - z) <= r) out.push(s);
      return out;
    };

    // ---- 2. contact wires ------------------------------------------------------
    const ribbons = new Ribbons();
    const zig = (s: number) => 0.2 * (Math.abs(((s / 30) % 1 + 1) % 1 * 2 - 1) * 2 - 1);
    let wireMetres = 0;
    for (const r of runs) {
      let arc = 0;
      const prev: number[][] = [[], []];
      r.s.forEach((s, i) => {
        if (i) arc += Math.hypot(s.x - r.s[i - 1].x, s.z - r.s[i - 1].z);
        s.arc = arc;
        const nx = -s.tz, nz = s.tx;
        [-1, 1].forEach((w, k) => {
          const o = w * 0.16 + zig(arc);
          const p = [s.x + nx * o, s.y + CONTACT_H, s.z + nz * o];
          if (prev[k].length) ribbons.add(prev[k][0], prev[k][1], prev[k][2], p[0], p[1], p[2]);
          prev[k] = p;
        });
      });
      wireMetres += arc * 2;
    }

    // ---- 3. masts ---------------------------------------------------------------
    const masts: Mast[] = [];
    const mgrid = new Map<string, Mast[]>();
    const mastNear = (x: number, z: number, r: number) => {
      const cx = Math.floor(x / 20), cz = Math.floor(z / 20);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const m of mgrid.get(`${cx + dx},${cz + dz}`) ?? []) if (Math.hypot(m.x - x, m.z - z) < r) return true;
      return false;
    };
    /** Is a mast at (x, z) on open ground clear of walls, props and tracks? Returns its base height. */
    const clear = (x: number, z: number, yRef: number, clearance: number, ignore: Set<Sample>): number | null => {
      if (!inside(x, z, 4)) return null;
      for (const s of near(x, z, clearance + 1)) {
        if (ignore.has(s)) continue;
        if (Math.hypot(s.x - x, s.z - z) < clearance) return null;
      }
      if (world && R) {
        const top = surface(x, z, yRef + 30);
        if (top === null || top < yRef - 0.35 || top > yRef + 0.9) return null;
        let free = true;
        world.intersectionsWithShape({ x, y: top + 1.7, z }, { x: 0, y: 0, z: 0, w: 1 }, new R.Cylinder(1.1, 0.42), () => ((free = false), false), fixedOnly);
        if (!free) return null;
        return top;
      }
      return yRef;
    };
    /** Free distance towards (ux, uz) from (x, z), up to [max] m (a roof or wall stops it). */
    const room = (x: number, z: number, ux: number, uz: number, yRef: number, max = 12) => {
      for (let d = 1; d <= max; d++) {
        const top = surface(x + ux * d, z + uz * d, yRef + 30);
        if (top === null || top > yRef + 1.6) return d;
      }
      return max;
    };

    const sorted = [...runs].sort((a, b) => b.s.length - a.s.length);
    for (const run of sorted) {
      if (run.s.length < 7) continue;
      const first = 3 + Math.floor(hash(run.id) * 6);
      for (let base = first; base < run.s.length - 2; base += MAST_SPACING / SAMPLE) {
        for (const shift of [0, 2, -2, 4, -4, 6, -6]) {
          const i = base + shift;
          if (i < 2 || i > run.s.length - 3) continue;
          const S = run.s[i];
          const nx = -S.tz, nz = S.tx;
          if (mastNear(S.x, S.z, MIN_MAST_GAP)) break;
          // A parallel track 2.3-6.6 m to the side, abreast of it.
          let pair: Sample | null = null, lat = 0;
          for (const Q of near(S.x, S.z, 8)) {
            if (Q.run === run.id) continue;
            const rx = Q.x - S.x, rz = Q.z - S.z;
            const along = rx * S.tx + rz * S.tz, l = rx * nx + rz * nz;
            if (Math.abs(along) > 3.5 || Math.abs(l) < 2.3 || Math.abs(l) > 6.6) continue;
            if (Math.abs(Q.tx * S.tx + Q.tz * S.tz) < 0.93) continue;
            if (!pair || Math.abs(l) < Math.abs(lat)) {
              pair = Q;
              lat = l;
            }
          }
          const ignore = new Set<Sample>();
          let placed: Mast | null = null;
          if (pair && Math.abs(lat) >= 3.3) {
            // On the median between the two tracks.
            const sgn = Math.sign(lat);
            const mx = S.x + nx * lat * 0.5, mz = S.z + nz * lat * 0.5;
            const y = clear(mx, mz, (S.y + pair.y) / 2, 1.5, ignore);
            if (y !== null) {
              const half = Math.abs(lat) / 2 + 0.8;
              placed = {
                x: mx, y, z: mz,
                arms: [
                  { ux: nx * sgn, uz: nz * sgn, len: half, tracks: [Math.abs(lat) / 2] },
                  { ux: -nx * sgn, uz: -nz * sgn, len: half, tracks: [Math.abs(lat) / 2] },
                ],
                covers: [S, pair],
              };
            }
          } else {
            const pairSide = pair ? Math.sign(lat) : 0;
            const sides = pair
              ? [-pairSide]
              : [1, -1].sort((a, b) => room(S.x, S.z, nx * b, nz * b, S.y) - room(S.x, S.z, nx * a, nz * a, S.y));
            for (const side of sides) {
              for (const d of [2.3, 2.6, 3.1, 3.7]) {
                const mx = S.x + nx * side * d, mz = S.z + nz * side * d;
                const y = clear(mx, mz, S.y, 1.85, ignore);
                if (y === null) continue;
                const reach = d + (pair ? Math.abs(lat) : 0);
                placed = {
                  x: mx, y, z: mz,
                  arms: [{ ux: -nx * side, uz: -nz * side, len: reach + 0.8, tracks: pair ? [d, d + Math.abs(lat)] : [d] }],
                  covers: pair ? [S, pair] : [S],
                };
                break;
              }
              if (placed) break;
            }
          }
          if (placed) {
            masts.push(placed);
            const k = `${Math.floor(placed.x / 20)},${Math.floor(placed.z / 20)}`;
            const l = mgrid.get(k);
            l ? l.push(placed) : mgrid.set(k, [placed]);
            break;
          }
        }
      }
    }

    // ---- 4. hangers, span wires, rosettes, globes, plates --------------------------
    const poleAt: THREE.Matrix4[] = [], armAt: THREE.Matrix4[] = [], globeAt: THREE.Matrix4[] = [];
    const plateAt: THREE.Matrix4[] = [], rosetteAt: THREE.Matrix4[] = [];
    const tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    let spans = 0, globes = 0, plates = 0;
    const cast = (ox: number, oy: number, oz: number, dx: number, dz: number, max: number) => {
      if (!world || !R) return null;
      const hit = world.castRayAndGetNormal(new R.Ray({ x: ox, y: oy, z: oz }, { x: dx, y: 0, z: dz }), max, true, fixedOnly);
      return hit ? { t: hit.timeOfImpact, nx: hit.normal.x, ny: hit.normal.y, nz: hit.normal.z } : null;
    };
    const spanMids: [number, number][] = [];
    masts.forEach((m, mi) => {
      poleAt.push(new THREE.Matrix4().makeTranslation(m.x, m.y, m.z));
      for (const arm of m.arms) {
        const ang = Math.atan2(-arm.uz, arm.ux); // rotation about y taking +x to (ux, uz)
        for (const [h, len] of [[ARM_Y, arm.len], [SPAN_Y + 0.35, Math.min(1.3, arm.len)]] as const) {
          tmpQ.setFromAxisAngle(Y, ang);
          armAt.push(new THREE.Matrix4().compose(tmpP.set(m.x + arm.ux * 0.1, m.y + h, m.z + arm.uz * 0.1), tmpQ, tmpS.set(len, 1, 1)));
        }
        // Hangers from the arm to the two wires over each track it covers.
        for (const s of m.covers) {
          const lx = s.x - m.x, lz = s.z - m.z;
          if (lx * arm.ux + lz * arm.uz < 0.3) continue; // another arm's track
          const nx = -s.tz, nz = s.tx;
          for (const w of [-1, 1]) {
            const o = w * 0.16 + zig(s.arc);
            ribbons.add(s.x, m.y + ARM_Y - 0.05, s.z, s.x + nx * o, s.y + CONTACT_H, s.z + nz * o);
          }
        }
        // Span wire to a facade rosette across the street.
        if (!R || !world) continue;
        const oy = m.y + SPAN_Y;
        const hits = [-0.8, 0, 0.8].map((o) => cast(m.x + arm.uz * o + arm.ux * 0.3, oy, m.z - arm.ux * o + arm.uz * 0.3, arm.ux, arm.uz, 26));
        const h0 = hits[1];
        if (!h0 || h0.t < 5) continue;
        if (hits.some((h) => !h || Math.abs(h.t - h0.t) > 0.7 || Math.abs(h.ny) > 0.3 || h.nx * arm.ux + h.nz * arm.uz > -0.4)) continue;
        const D = h0.t + 0.3;
        const ex = m.x + arm.ux * D, ez = m.z + arm.uz * D;
        const sag = 0.03 * D;
        const N = Math.max(6, Math.round(D / 2.5));
        const pts: number[] = [];
        const yAt = (t: number) => oy - 4 * sag * t * (1 - t);
        for (let k = 0; k <= N; k++) {
          const t = k / N;
          pts.push(m.x + (ex - m.x) * t, yAt(t), m.z + (ez - m.z) * t);
        }
        ribbons.line(pts);
        spans++;
        spanMids.push([(m.x + ex) / 2, (m.z + ez) / 2]);
        // A rosette on the wall (a disc facing the street).
        tmpQ.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tmpS.set(h0.nx, 0, h0.nz).normalize());
        rosetteAt.push(new THREE.Matrix4().compose(tmpP.set(ex - arm.ux * 0.05, oy, ez - arm.uz * 0.05), tmpQ, new THREE.Vector3(1, 1, 1)));
        // Hanging globe over the first track this span crosses, and a speed plate.
        const near1 = MOUTHS.some(([x, z, r]) => Math.hypot(m.x - x, m.z - z) < r);
        const hs = hash(mi * 7 + arm.ux * 3.1 + arm.uz * 5.7);
        const dTrack = arm.tracks[0] / D;
        if (dTrack > 0.05 && dTrack < 0.95 && (near1 || hs < 0.25)) {
          const gx = m.x + (ex - m.x) * dTrack, gz = m.z + (ez - m.z) * dTrack;
          const sy = yAt(dTrack);
          const rod = 0.55;
          ribbons.add(gx, sy, gz, gx, sy - rod, gz);
          globeAt.push(new THREE.Matrix4().makeTranslation(gx, sy - rod - 0.22, gz));
          globes++;
        }
        if (near1 ? hs < 0.55 : hs > 0.9) {
          const t = Math.min(0.9, Math.max(0.1, dTrack * 0.5 + 0.02));
          const px = m.x + (ex - m.x) * t, pz = m.z + (ez - m.z) * t, sy = yAt(t);
          ribbons.add(px, sy, pz, px, sy - 0.25, pz);
          tmpQ.setFromAxisAngle(Y, ang); // plate normal along the track, across the span
          plateAt.push(new THREE.Matrix4().compose(tmpP.set(px, sy - 0.25 - 0.22, pz), tmpQ, new THREE.Vector3(1, 1, 1)));
          plates++;
        }
      }
    });

    // Facade to facade across a narrow street, over the track: at the mouths (with globes and
    // plates) and now and then elsewhere.
    if (R && world) {
      const facade = (ox: number, oy: number, oz: number, ux: number, uz: number, max: number) => {
        const hs = [-0.8, 0, 0.8].map((o) => cast(ox + uz * o, oy, oz - ux * o, ux, uz, max));
        const h0 = hs[1];
        if (!h0 || h0.t < 2.5) return null;
        if (hs.some((h) => !h || Math.abs(h.t - h0.t) > 0.7 || Math.abs(h.ny) > 0.3 || h.nx * ux + h.nz * uz > -0.4)) return null;
        return h0;
      };
      for (const run of runs) {
        for (let i = 3 + Math.floor(hash(run.id + 5) * 4); i < run.s.length - 2; i += 6) {
          const S = run.s[i];
          const mouth = MOUTHS.some(([x, z, r]) => Math.hypot(S.x - x, S.z - z) < r);
          if (!mouth && hash(run.id * 13 + i) > 0.1) continue;
          if (spanMids.some(([x, z]) => Math.hypot(x - S.x, z - S.z) < (mouth ? 9 : 25))) continue;
          const nx = -S.tz, nz = S.tx, oy = S.y + 7.0;
          const L = facade(S.x, oy, S.z, -nx, -nz, 22), Rt = facade(S.x, oy, S.z, nx, nz, 22);
          if (!L || !Rt || L.t + Rt.t > 34) continue;
          const D = L.t + Rt.t;
          const ax = S.x - nx * L.t, az = S.z - nz * L.t;
          const sag = 0.03 * D, N = Math.max(6, Math.round(D / 2.5));
          const yAt = (t: number) => oy - 4 * sag * t * (1 - t);
          const pts: number[] = [];
          for (let k = 0; k <= N; k++) {
            const t = k / N;
            pts.push(ax + nx * D * t, yAt(t), az + nz * D * t);
          }
          ribbons.line(pts);
          spans++;
          spanMids.push([S.x, S.z]);
          for (const [h, sx, sz, sgn] of [[L, ax, az, -1], [Rt, ax + nx * D, az + nz * D, 1]] as const) {
            tmpQ.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tmpS.set(h.nx, 0, h.nz).normalize());
            rosetteAt.push(new THREE.Matrix4().compose(tmpP.set(sx - nx * sgn * 0.05, oy, sz - nz * sgn * 0.05), tmpQ, new THREE.Vector3(1, 1, 1)));
          }
          const tc = L.t / D, hs = hash(run.id * 31 + i);
          if (mouth || hs < 0.4) {
            const sy = yAt(tc);
            ribbons.add(S.x, sy, S.z, S.x, sy - 0.55, S.z);
            globeAt.push(new THREE.Matrix4().makeTranslation(S.x, sy - 0.77, S.z));
            globes++;
          }
          if (mouth ? hs < 0.7 : hs > 0.75) {
            const t = tc + (hs < 0.35 ? -0.18 : 0.2);
            const px = ax + nx * D * t, pz = az + nz * D * t, sy = yAt(t);
            ribbons.add(px, sy, pz, px, sy - 0.25, pz);
            tmpQ.setFromAxisAngle(Y, Math.atan2(S.tx, S.tz));
            plateAt.push(new THREE.Matrix4().compose(tmpP.set(px, sy - 0.47, pz), tmpQ, new THREE.Vector3(1, 1, 1)));
            plates++;
          }
        }
      }
    }

    // ---- 5. meshes --------------------------------------------------------------
    const { material: wireMat, uniforms } = ribbonMaterial();
    const sz = new THREE.Vector2();
    const onBefore = (r: THREE.WebGLRenderer, c: THREE.Camera) => {
      const rt = r.getRenderTarget();
      const h = rt ? rt.height : r.getDrawingBufferSize(sz).y;
      uniforms.uPx.value = 2 / ((c as THREE.PerspectiveCamera).projectionMatrix.elements[5] * h);
    };
    const built = ribbons.build(wireMat, onBefore, this.root);
    let tris = built.tris, draws = built.draws;

    const white = new THREE.MeshStandardMaterial({ color: 0xf0eee8, roughness: 0.55, metalness: 0.15 });
    const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], name: string, shadow = false) => {
      if (!mats.length) return;
      const mesh = new THREE.InstancedMesh(geo, mat, mats.length);
      mats.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.name = name;
      mesh.castShadow = shadow;
      mesh.receiveShadow = false;
      mesh.frustumCulled = true;
      mesh.computeBoundingSphere();
      this.root.add(mesh);
      draws++;
      tris += mats.length * ((geo.index?.count ?? geo.attributes.position.count) / 3);
    };
    // The pole: a tapered tube with collars at the foot, under the arm and at the cap.
    const profile: [number, number][] = [
      [0.34, 0], [0.34, 0.3], [0.27, 0.42], [0.26, 1.6], [0.32, 1.66], [0.32, 1.8], [0.25, 1.86], [0.21, 5.4],
      [0.27, 5.46], [0.27, 5.58], [0.2, 5.64], [0.185, MAST_H - 0.4], [0.24, MAST_H - 0.35], [0.13, MAST_H - 0.15], [0, MAST_H],
    ];
    const pole = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 8);
    instanced(pole, white, poleAt, 'catenary_masts', true);
    const armGeo = new THREE.CylinderGeometry(0.06, 0.06, 1, 6, 1, true).rotateZ(Math.PI / 2).translate(0.5, 0, 0);
    instanced(armGeo, white, armAt, 'catenary_arms');
    const globe = new THREE.MeshStandardMaterial({ color: 0xf6f5ef, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.3 });
    instanced(new THREE.SphereGeometry(0.22, 10, 7), globe, globeAt, 'catenary_globes');
    // Speed plate: a yellow diamond with a dark bar for the number, both faces.
    const plate = new THREE.BufferGeometry();
    {
      const v: number[] = [], c: number[] = [];
      const quad = (pts: number[][], col: number[]) => {
        for (const i of [0, 1, 2, 0, 2, 3]) {
          v.push(...pts[i]);
          c.push(...col);
        }
      };
      const dia = (r: number, z: number, col: number[]) => quad([[0, r, z], [-r, 0, z], [0, -r, z], [r, 0, z]], col);
      for (const z of [0.004, -0.004]) {
        dia(0.24, z, [1, 0.8, 0.05]);
        quad([[-0.1, 0.05, z * 2], [-0.1, -0.05, z * 2], [0.1, -0.05, z * 2], [0.1, 0.05, z * 2]], [0.08, 0.08, 0.08]);
      }
      plate.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      plate.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    }
    instanced(plate, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }), plateAt, 'catenary_plates');
    instanced(
      new THREE.CylinderGeometry(0.2, 0.2, 0.08, 10).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.6, metalness: 0.4 }),
      rosetteAt,
      'catenary_rosettes',
    );

    // ---- 6. colliders ------------------------------------------------------------
    let colliders = 0;
    if (R && world) {
      for (const m of masts) {
        world.createCollider(R.ColliderDesc.cylinder(2.5, 0.3).setTranslation(m.x, m.y + 2.5, m.z));
        colliders++;
      }
    }

    this.mastPos = masts.map((m) => [Math.round(m.x * 10) / 10, Math.round(m.z * 10) / 10]);
    Object.assign(this.stats, { masts: masts.length, wireMetres: Math.round(wireMetres), triangles: tris, drawCalls: draws, spans, globes, plates, colliders });
    console.log(
      `[zg] catenary: ${masts.length} masts, ${(wireMetres / 1000).toFixed(2)} km of wire, ${spans} span wires, ${globes} globes, ${plates} plates, ` +
        `${tris} triangles in ${draws} draw calls, ${(performance.now() - t0).toFixed(0)} ms to build`,
    );
  }
}

function lineLength(l: P[]) {
  let s = 0;
  for (let i = 1; i < l.length; i++) s += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]);
  return s;
}
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];

/** Resamples [line] every [step] metres, returning the runs that lie inside. */
function resample(line: P[], step: number, ok: (x: number, z: number) => boolean): P[][] {
  const out: P[][] = [];
  let cur: P[] = [];
  const push = (x: number, z: number) => {
    if (ok(x, z)) cur.push([x, z]);
    else if (cur.length) {
      out.push(cur);
      cur = [];
    }
  };
  let next = 0, acc = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, az] = line[i], [bx, bz] = line[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    while (next <= acc + len) {
      const t = (next - acc) / len;
      push(ax + (bx - ax) * t, az + (bz - az) * t);
      next += step;
    }
    acc += len;
  }
  if (cur.length) out.push(cur);
  return out;
}
