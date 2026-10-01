// Zagreb Cathedral (katedrala Uznesenja BDM, Kaptol 31), built by hand. The OSM outline and its
// building:parts are left out of the city (data/buildings.json `omit`), and city.json `landmarks`
// places this model: {x, y, z} is the middle of the west front at its ground, `heading` the church
// axis (degrees clockwise from north, pointing east into the church).
//
// Local frame: x runs along the axis from the west front (x = 0) to the apse, z across it (south
// positive), y up from the ground at the front. Proportions from the OSM outline and a rectified
// Street View photo of the front (Jul 2024): the front block and its gallery to 37.4 m, the gable
// to 47.5 m, the square towers to 62 m, the openwork spires to 105 m (as before the 2020
// earthquake; in 2024 both tops were in scaffolding), the hall to its eaves at 26 m.
//
// Textures (tool/make_cathedral.py -> public/models/cathedral/): redrawings of the photos. Only the
// lower 20 m of the west front, what the player sees up close from the square, is full resolution;
// everything high up (the upper front, the towers, the spires) and everything the player cannot
// reach (the fenced side walls, the apse, the roofs, the backs) is deliberately tiny (~3 px/m).

import * as THREE from 'three';
import type RAPIER_NS from '@dimforge/rapier3d-compat';

export interface Landmark {
  name: string;
  x: number;
  y: number;
  z: number;
  heading: number;
}

type P2 = [number, number]; // (x along the axis, z across, south positive)
type V3 = [number, number, number];

// The west front textures: 36.9 m wide (z -18.45 north .. 18.45 south). front.jpg covers the
// pavement to FRONT_SPLIT at full resolution; front_high.jpg the whole front to 54.4 m, tiny, for
// everything higher up.
const FRONT_HALF = 18.45;
const FRONT_TEX_H = 54.4;
const FRONT_SPLIT = 20;
const FRONT_DEPTH = 11.6; // the front block, towers included, x 0..11.6
const GALLERY = 37.4; // top of the front block and its balustrade
const TOWER = { x0: 0.3, x1: 11.3, z0: 5.5, z1: 16.8, top: 62 }; // one tower; the other is mirrored
const TOWER_TEX_H = 24.6; // tower.jpg: the gallery to the top cornice
const SPIRE_TOP = 105;
const EAVE = 26;
const RIDGE = 47.5;
const FLOOR = -8; // the ground falls ~6 m towards the apse
// side.png: three bays, 22.2 m wide, ground to the gable tips 31.9 m; the eaves at v = 0.8145.
const SIDE_W = 22.2;
const SIDE_H = 31.9;

/** The hall and the chancel, walked round from the south-west corner (behind the front block). */
const HALL: P2[] = [
  [11.6, 19.3], [61.0, 19.3], [65.6, 11.3], [68.2, 9.1], [73.5, 9.1], [78.4, 3.1],
  [78.4, -2.3], [73.5, -8.2], [68.2, -8.2], [65.6, -10.6], [62.2, -17.9], [61.0, -18.3], [11.6, -18.3],
];
const BAYS = [16.15, 23.4, 30.8, 38.3, 46.9, 56.8];
const BUTTRESSES: [number, number, number][] = [
  // x, z (a point on the wall), depth
  ...[12.65, 19.75, 27.0, 34.5, 42.0, 51.8].map((x): [number, number, number] => [x, 19.3, 3.1]),
  ...[12.65, 19.9, 27.3, 34.6].map((x): [number, number, number] => [x, -18.3, 2.1]),
  [63.3, 15.3, 2.4], [70.8, 9.1, 1.8], [75.9, 6.1, 1.8], [78.4, 0.4, 1.8], [75.9, -5.3, 1.8], [70.8, -8.2, 1.8], [63.9, -14.3, 2.4],
];

class Builder {
  readonly pos: number[] = [];
  readonly uv: number[] = [];

  /** A triangle, wound counter-clockwise from the side `out` points to (a direction, or a point it faces away from). */
  tri(a: V3, b: V3, c: V3, ua: P2, ub: P2, uc: P2, away?: V3) {
    if (away) {
      const n = new THREE.Vector3(...b).sub(new THREE.Vector3(...a)).cross(new THREE.Vector3(...c).sub(new THREE.Vector3(...a)));
      const toward = new THREE.Vector3(...a).sub(new THREE.Vector3(...away));
      if (n.dot(toward) < 0) [b, c, ub, uc] = [c, b, uc, ub];
    }
    this.pos.push(...a, ...b, ...c);
    this.uv.push(...ua, ...ub, ...uc);
  }

  /** A quad a b c d (in order round its edge) facing away from `away`. */
  quad(a: V3, b: V3, c: V3, d: V3, ua: P2, ub: P2, uc: P2, ud: P2, away?: V3) {
    this.tri(a, b, c, ua, ub, uc, away);
    this.tri(a, c, d, ua, uc, ud, away);
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    return g;
  }
}

/** A box's four walls (into `b`, or `b(face)`) and top, `uv(face, t across 0..1, y)` per vertex. */
function boxWalls(b: Builder | ((face: number) => Builder), x0: number, x1: number, z0: number, z1: number, y0: number, y1: number,
  uv: (face: number, t: number, y: number) => P2, top?: Builder) {
  const pick = typeof b === 'function' ? b : () => b;
  const c: V3 = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
  // Faces: 0 west (x0), 1 north (z0), 2 east (x1), 3 south (z1); t runs left to right as seen from outside.
  const faces: [P2, P2][] = [
    [[x0, z0], [x0, z1]],
    [[x1, z0], [x0, z0]],
    [[x1, z1], [x1, z0]],
    [[x0, z1], [x1, z1]],
  ];
  faces.forEach(([[ax, az], [bx, bz]], f) => {
    pick(f).quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], uv(f, 0, y0), uv(f, 1, y0), uv(f, 1, y1), uv(f, 0, y1), c);
  });
  if (top) {
    top.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [x0 / 2, z0 / 2], [x1 / 2, z0 / 2], [x1 / 2, z1 / 2], [x0 / 2, z1 / 2], [c[0], y1 - 1, c[2]]);
  }
}

/** An n-sided pyramid (or frustum) round (cx, cz): `uv(t across a face, h 0..1)`. */
function pyramid(b: Builder, cx: number, cz: number, r0: number, r1: number, y0: number, y1: number, n: number,
  uv: (t: number, h: number) => P2 = (t, h) => [t, h], phase = Math.PI / n) {
  const at = (k: number, r: number, y: number): V3 => {
    const a = phase + (k / n) * Math.PI * 2;
    return [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
  };
  for (let k = 0; k < n; k++) {
    const a0 = at(k, r0, y0), a1 = at(k + 1, r0, y0);
    if (r1 <= 0.001) {
      b.tri(a0, a1, [cx, y1, cz], uv(0, 0), uv(1, 0), uv(0.5, 1), [cx, y0 - 50, cz]);
    } else {
      b.quad(a0, a1, at(k + 1, r1, y1), at(k, r1, y1), uv(0, 0), uv(1, 0), uv(1, 1), uv(0, 1), [cx, (y0 + y1) / 2, cz]);
    }
  }
}

function load(url: string, opts: { repeat?: boolean; repeatS?: boolean; aniso?: number } = {}) {
  const t = new THREE.TextureLoader().load(url);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = opts.aniso ?? 8;
  if (opts.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (opts.repeatS) t.wrapS = THREE.RepeatWrapping;
  return t;
}

export function buildCathedral(l: Landmark, R: typeof RAPIER_NS, world: RAPIER_NS.World): THREE.Group {
  const dir = 'models/cathedral/';
  const mat = (map: THREE.Texture, extra: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0, ...extra });
  const mFront = mat(load(dir + 'front.jpg', { aniso: 12 }));
  const mFrontHigh = mat(load(dir + 'front_high.jpg'));
  const mTower = mat(load(dir + 'tower.jpg', { aniso: 12 }));
  const mSide = mat(load(dir + 'side.png', { repeatS: true }), { alphaTest: 0.5 });
  const mStone = mat(load(dir + 'stone.jpg', { repeat: true }));
  const mRoof = mat(load(dir + 'roof.jpg', { repeat: true }), { roughness: 0.7, metalness: 0.15 });
  const mSpire = mat(load(dir + 'spire.png', { aniso: 12 }), { alphaTest: 0.5, side: THREE.DoubleSide });
  const mMetal = new THREE.MeshStandardMaterial({ color: 0x4a4436, roughness: 0.5, metalness: 0.6 });

  const front = new Builder();
  const frontHigh = new Builder();
  const unused = new Builder();
  const tower = new Builder();
  const side = new Builder();
  const stone = new Builder();
  const roof = new Builder();
  const spire = new Builder();
  const metal = new Builder();

  const fuv = (z: number, y: number): P2 => [(z + FRONT_HALF) / (2 * FRONT_HALF), y / FRONT_SPLIT];
  const fuvHigh = (z: number, y: number): P2 => [(z + FRONT_HALF) / (2 * FRONT_HALF), y / FRONT_TEX_H];

  // ---- the front block (both towers up to the gallery) -------------------------------------
  const strip = 11.9 / (2 * FRONT_HALF); // one tower's share of the front picture
  // The west face: sharp up to FRONT_SPLIT, the tiny picture above.
  for (const [y0, y1, b, uv] of [[-4, FRONT_SPLIT, front, fuv], [FRONT_SPLIT, GALLERY, frontHigh, fuvHigh]] as const) {
    b.quad([0, y0, -FRONT_HALF], [0, y0, FRONT_HALF], [0, y1, FRONT_HALF], [0, y1, -FRONT_HALF],
      uv(-FRONT_HALF, y0), uv(FRONT_HALF, y0), uv(FRONT_HALF, y1), uv(-FRONT_HALF, y1), [5, 10, 0]);
  }
  boxWalls((f) => (f === 2 ? stone : f === 0 ? unused : frontHigh), 0, FRONT_DEPTH, -FRONT_HALF, FRONT_HALF, -4, GALLERY, (f, t, y) => {
    // The north and south faces (behind the fences) repeat the tower's own strip of the front, low-res.
    if (f === 1) return [(1 - t) * strip, y / FRONT_TEX_H];
    if (f === 3) return [1 - t * strip, y / FRONT_TEX_H];
    return [t * FRONT_HALF, y / 2]; // east, stone: behind the hall, seen only above its roof
  });
  boxWalls(stone, 0, FRONT_DEPTH, -FRONT_HALF, FRONT_HALF, GALLERY - 0.01, GALLERY, () => [0, 0], stone);

  // ---- the porch: the main portal's canopy stands 2.7 m proud of the front ----------------------
  {
    const x0 = -2.7, zh = 6.8, top = 12.6;
    front.quad([x0, -3, -zh], [x0, -3, zh], [x0, top, zh], [x0, top, -zh], fuv(-zh, -3), fuv(zh, -3), fuv(zh, top), fuv(-zh, top), [0, 5, 0]);
    // Its gable, 9.2 m wide, to 19.2 m, and the two pinnacled buttresses beside it.
    const g = 4.6, apex = 19.2;
    front.tri([x0, top, -g], [x0, top, g], [x0, apex, 0], fuv(-g, top), fuv(g, top), fuv(0, apex), [0, 15, 0]);
    roof.quad([x0, top, -g], [x0, apex, 0], [0, apex, 0], [0, top, -g], [0, 0], [0, 2], [1, 2], [1, 0], [x0 / 2, top, 0]);
    roof.quad([x0, top, g], [x0, apex, 0], [0, apex, 0], [0, top, g], [0, 0], [0, 2], [1, 2], [1, 0], [x0 / 2, top, 0]);
    for (const s of [-1, 1]) {
      stone.quad([x0, -3, s * zh], [0, -3, s * zh], [0, top, s * zh], [x0, top, s * zh], [0, -1.5], [1.35, -1.5], [1.35, top / 2], [0, top / 2], [x0 / 2, 5, 0]);
      pyramid(stone, x0 / 2, s * 5.9, 0.55, 0, top, 17.6, 8, (t, h) => [t, h * 3]);
    }
    stone.quad([x0, top, -zh], [0, top, -zh], [0, top, zh], [x0, top, zh], [0, 0], [1, 0], [1, 5], [0, 5], [x0 / 2, 0, 0]);
  }

  // ---- the gable between the towers, and its cross ---------------------------------------------
  {
    const g = 5.3, apex = RIDGE, back = 4.3;
    frontHigh.tri([0, GALLERY, -g], [0, GALLERY, g], [0, apex, 0], fuvHigh(-g, GALLERY), fuvHigh(g, GALLERY), fuvHigh(0, apex), [5, 40, 0]);
    roof.quad([0, GALLERY, -g], [0, apex, 0], [back, apex, 0], [back, GALLERY, -g], [0, 0], [0, 3], [1, 3], [1, 0], [back / 2, GALLERY, 0]);
    roof.quad([0, GALLERY, g], [0, apex, 0], [back, apex, 0], [back, GALLERY, g], [0, 0], [0, 3], [1, 3], [1, 0], [back / 2, GALLERY, 0]);
    boxWalls(stone, -0.12, 0.12, -0.12, 0.12, apex, apex + 2.4, (_f, t, y) => [t, y]);
    boxWalls(stone, -0.12, 0.12, -0.8, 0.8, apex + 1.4, apex + 1.7, (_f, t, y) => [t, y]);
  }

  // ---- the towers: the belfry and clock stage, then pinnacles, gablets and the openwork spire ----
  for (const s of [-1, 1]) {
    const z0 = s < 0 ? -TOWER.z1 : TOWER.z0;
    const z1 = s < 0 ? -TOWER.z0 : TOWER.z1;
    boxWalls(tower, TOWER.x0, TOWER.x1, z0, z1, GALLERY - 1.5, TOWER.top, (_f, t, y) => [t, (y - GALLERY) / TOWER_TEX_H], stone);
    const cx = (TOWER.x0 + TOWER.x1) / 2, cz = (z0 + z1) / 2, half = (TOWER.x1 - TOWER.x0) / 2;
    // The octagonal spire, see-through tracery (double-sided).
    pyramid(spire, cx, cz, half - 1.3, 0, TOWER.top, SPIRE_TOP, 8, (t, h) => [t, h * 1.0], Math.PI / 8);
    // Its cross.
    boxWalls(metal, cx - 0.1, cx + 0.1, cz - 0.1, cz + 0.1, SPIRE_TOP - 0.5, SPIRE_TOP + 2.6, (_f, t, y) => [t, y]);
    boxWalls(metal, cx - 0.1, cx + 0.1, cz - 0.75, cz + 0.75, SPIRE_TOP + 1.3, SPIRE_TOP + 1.6, (_f, t, y) => [t, y]);
    // Corner pinnacles: an octagonal shaft and a crocketed needle.
    for (const [px, pz] of [[TOWER.x0 + 0.8, z0 + 0.8], [TOWER.x1 - 0.8, z0 + 0.8], [TOWER.x0 + 0.8, z1 - 0.8], [TOWER.x1 - 0.8, z1 - 0.8]]) {
      pyramid(stone, px, pz, 0.75, 0.75, TOWER.top, TOWER.top + 6, 8, (t, h) => [t, h * 3]);
      pyramid(stone, px, pz, 0.8, 0, TOWER.top + 6, TOWER.top + 14, 8, (t, h) => [t, h * 4]);
    }
    // A gablet on each face.
    const gw = 2.6, gh = 7;
    for (const [ax, az, nx, nz] of [[TOWER.x0, cz, -1, 0], [TOWER.x1, cz, 1, 0], [cx, z0, 0, -1], [cx, z1, 0, 1]]) {
      const tx = -nz, tz = nx; // along the face
      const p = (u: number, y: number, o: number): V3 => [ax + tx * u + nx * o, y, az + tz * u + nz * o];
      const inner: V3 = [cx, TOWER.top + 2, cz];
      stone.tri(p(-gw, TOWER.top, 0.05), p(gw, TOWER.top, 0.05), p(0, TOWER.top + gh, 0.05), [0, 0], [2.6, 0], [1.3, 3.5], inner);
      stone.quad(p(-gw, TOWER.top, 0.05), p(0, TOWER.top + gh, 0.05), p(0, TOWER.top + gh, -2.5), p(-gw, TOWER.top, -2.5), [0, 0], [0, 3], [1, 3], [1, 0], inner);
      stone.quad(p(gw, TOWER.top, 0.05), p(0, TOWER.top + gh, 0.05), p(0, TOWER.top + gh, -2.5), p(gw, TOWER.top, -2.5), [0, 0], [0, 3], [1, 3], [1, 0], inner);
    }
  }

  // ---- the hall and the chancel: low-res side walls, buttresses, bay gables --------------------
  {
    let along = 0;
    const centre: V3 = [45, 10, 0];
    for (let i = 0; i + 1 < HALL.length; i++) {
      const [ax, az] = HALL[i], [bx, bz] = HALL[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const u0 = along / SIDE_W, u1 = (along + len) / SIDE_W;
      side.quad([ax, FLOOR, az], [bx, FLOOR, bz], [bx, EAVE, bz], [ax, EAVE, az],
        [u0, FLOOR / SIDE_H], [u1, FLOOR / SIDE_H], [u1, EAVE / SIDE_H], [u0, EAVE / SIDE_H], centre);
      along += len;
    }
    // Flat cap under the roofs.
    const shape = HALL.map(([x, z]) => new THREE.Vector2(x, z));
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(shape, [])) {
      const p = (k: number): V3 => [HALL[k][0], EAVE, HALL[k][1]];
      roof.tri(p(a), p(b), p(c), [HALL[a][0] / 4, HALL[a][1] / 4], [HALL[b][0] / 4, HALL[b][1] / 4], [HALL[c][0] / 4, HALL[c][1] / 4], [40, 0, 0]);
    }
    // The hall roof: one steep roof over all three aisles, its east end a stone gable.
    const zs = 19.3, zn = -18.3, zr = 0.5, x0 = 2, x1 = 62;
    const slope = (RIDGE - EAVE) / (zs - zr);
    const rv = (z: number, y: number) => Math.hypot(z - zr, (y - EAVE) / slope) / 4;
    roof.quad([x0, EAVE, zs], [x1, EAVE, zs], [x1, RIDGE, zr], [x0, RIDGE, zr], [x0 / 4, 0], [x1 / 4, 0], [x1 / 4, rv(zs, RIDGE)], [x0 / 4, rv(zs, RIDGE)], [30, 0, 0]);
    roof.quad([x0, EAVE, zn], [x1, EAVE, zn], [x1, RIDGE, zr], [x0, RIDGE, zr], [x0 / 4, 0], [x1 / 4, 0], [x1 / 4, rv(zn, RIDGE)], [x0 / 4, rv(zn, RIDGE)], [30, 0, 0]);
    stone.tri([x1, EAVE, zs], [x1, EAVE, zn], [x1, RIDGE, zr], [0, 0], [18.8, 0], [9.4, 10.7], [0, 30, 0]);
    // The chancel roof and the hip over the apse.
    const cs = 9.1, cn = -8.2, cr = 0.45, cx1 = 73.5;
    const cridge = EAVE + (cs - cr) * slope;
    roof.quad([x1, EAVE, cs], [cx1, EAVE, cs], [cx1, cridge, cr], [x1, cridge, cr], [0, 0], [3, 0], [3, 2.8], [0, 2.8], [65, 0, cr]);
    roof.quad([x1, EAVE, cn], [cx1, EAVE, cn], [cx1, cridge, cr], [x1, cridge, cr], [0, 0], [3, 0], [3, 2.8], [0, 2.8], [65, 0, cr]);
    const apse: P2[] = [[73.5, 9.1], [78.4, 3.1], [78.4, -2.3], [73.5, -8.2]];
    for (let i = 0; i + 1 < apse.length; i++) {
      const [ax, az] = apse[i], [bx, bz] = apse[i + 1];
      roof.tri([ax, EAVE, az], [bx, EAVE, bz], [cx1, cridge, cr], [0, 0], [1.8, 0], [0.9, 2.8], [70, 0, cr]);
    }
    // Bay gables over both side walls, each with its little roof running into the big one.
    const gw = 2.8, gh = 6.2, gu = 0.1025, gv0 = EAVE / SIDE_H, gv1 = 0.961;
    for (const z of [zs, zn]) {
      const o = Math.sign(z) * 0.05;
      for (const x of BAYS) {
        side.tri([x - gw, EAVE, z + o], [x + gw, EAVE, z + o], [x, EAVE + gh, z + o],
          [0.5 - gu, gv0], [0.5 + gu, gv0], [0.5, gv1], [x, EAVE, 0]);
        const zin = z - Math.sign(z) * 7;
        roof.quad([x - gw, EAVE, z], [x, EAVE + gh, z], [x, EAVE + gh, zin], [x - gw, EAVE, zin], [0, 0], [0, 1.7], [1.8, 1.7], [1.8, 0], [x, EAVE, 0]);
        roof.quad([x + gw, EAVE, z], [x, EAVE + gh, z], [x, EAVE + gh, zin], [x + gw, EAVE, zin], [0, 0], [0, 1.7], [1.8, 1.7], [1.8, 0], [x, EAVE, 0]);
      }
    }
    // Buttresses, square to the wall they stand on, each ending in a pinnacle.
    for (const [bx, bz, depth] of BUTTRESSES) {
      let best = Infinity, n: P2 = [0, 1];
      for (let i = 0; i + 1 < HALL.length; i++) {
        const [ax, az] = HALL[i], [cx, cz] = HALL[i + 1];
        const dx = cx - ax, dz = cz - az, l2 = dx * dx + dz * dz;
        const t = Math.max(0, Math.min(1, ((bx - ax) * dx + (bz - az) * dz) / l2));
        const d = Math.hypot(ax + dx * t - bx, az + dz * t - bz);
        if (d < best) {
          best = d;
          const l = Math.sqrt(l2);
          n = [dz / l, -dx / l];
          if (n[0] * (bx - 40) + n[1] * bz < 0) n = [-n[0], -n[1]];
        }
      }
      const t: P2 = [-n[1], n[0]];
      const w = 1.0;
      const top = depth > 2 ? 24 : 22;
      const q = (a: number, o: number, y: number): V3 => [bx + t[0] * a + n[0] * o, y, bz + t[1] * a + n[1] * o];
      const mid: V3 = [bx + n[0] * depth / 2, 10, bz + n[1] * depth / 2];
      const sUV = (a: number, y: number): P2 => [a / 2, y / 2];
      stone.quad(q(-w, -0.2, FLOOR), q(-w, depth, FLOOR), q(-w, depth, top - 3), q(-w, -0.2, top), sUV(0, FLOOR), sUV(depth, FLOOR), sUV(depth, top - 3), sUV(0, top), mid);
      stone.quad(q(w, -0.2, FLOOR), q(w, depth, FLOOR), q(w, depth, top - 3), q(w, -0.2, top), sUV(0, FLOOR), sUV(depth, FLOOR), sUV(depth, top - 3), sUV(0, top), mid);
      stone.quad(q(-w, depth, FLOOR), q(w, depth, FLOOR), q(w, depth, top - 3), q(-w, depth, top - 3), sUV(0, FLOOR), sUV(2, FLOOR), sUV(2, top - 3), sUV(0, top - 3), mid);
      stone.quad(q(-w, depth, top - 3), q(w, depth, top - 3), q(w, -0.2, top), q(-w, -0.2, top), [0, 0], [1, 0], [1, 1.5], [0, 1.5], mid);
      const [px, , pz] = q(0, 0.6, 0);
      pyramid(stone, px, pz, 0.6, 0.6, top - 1, top + 2.5, 8, (tt, h) => [tt, h * 2]);
      pyramid(stone, px, pz, 0.65, 0, top + 2.5, top + 8, 8, (tt, h) => [tt, h * 3]);
    }
    // The sacristy against the north side, a plain stone block with a gabled roof.
    const sx0 = 41.1, sx1 = 74.8, sz0 = -26.6, sz1 = -18.0, se = 12;
    boxWalls(stone, sx0, sx1, sz0, sz1, FLOOR, se, (f, tt, y) => [tt * (f % 2 ? sx1 - sx0 : sz1 - sz0) / 2, y / 2]);
    const sr = (sz0 + sz1) / 2, sh = se + 4.5;
    roof.quad([sx0, se, sz0], [sx1, se, sz0], [sx1, sh, sr], [sx0, sh, sr], [0, 0], [8, 0], [8, 1.3], [0, 1.3], [58, 0, sr]);
    roof.quad([sx0, se, sz1], [sx1, se, sz1], [sx1, sh, sr], [sx0, sh, sr], [0, 0], [8, 0], [8, 1.3], [0, 1.3], [58, 0, sr]);
    stone.tri([sx0, se, sz0], [sx0, se, sz1], [sx0, sh, sr], [0, 0], [4, 0], [2, 2], [58, se, sr]);
    stone.tri([sx1, se, sz0], [sx1, se, sz1], [sx1, sh, sr], [0, 0], [4, 0], [2, 2], [58, se, sr]);
  }

  const root = new THREE.Group();
  root.name = 'cathedral';
  for (const [b, m] of [[front, mFront], [frontHigh, mFrontHigh], [tower, mTower], [side, mSide], [stone, mStone], [roof, mRoof], [spire, mSpire], [metal, mMetal]] as const) {
    if (!b.pos.length) continue;
    const mesh = new THREE.Mesh(b.geometry(), m);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  }
  const rot = Math.PI / 2 - THREE.MathUtils.degToRad(l.heading);
  root.position.set(l.x, l.y, l.z);
  root.rotation.y = rot;

  // Static colliders (local boxes): the front block, the porch, the hall, the chancel, the sacristy.
  const c = Math.cos(rot), s = Math.sin(rot);
  const box = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number) => {
    const lx = (x0 + x1) / 2, lz = (z0 + z1) / 2, ly = (y0 + y1) / 2;
    world.createCollider(
      R.ColliderDesc.cuboid((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2)
        .setTranslation(l.x + lx * c + lz * s, l.y + ly, l.z - lx * s + lz * c)
        .setRotation({ x: 0, y: Math.sin(rot / 2), z: 0, w: Math.cos(rot / 2) }),
    );
  };
  box(0, FRONT_DEPTH, -FRONT_HALF, FRONT_HALF, FLOOR, GALLERY);
  box(-2.7, 0, -6.8, 6.8, FLOOR, 12.6);
  box(FRONT_DEPTH, 61, -18.3, 19.3, FLOOR, EAVE);
  box(61, 78.4, -10.6, 11.3, FLOOR, EAVE);
  box(41.1, 74.8, -26.6, -18, FLOOR, 12);
  return root;
}
