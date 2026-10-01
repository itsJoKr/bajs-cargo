// Covered passages through the blocks (city.json `passages`, data/passages.json, tool/src/passages.dart):
// Marićev prolaz from Gajeva to Praška, and the Oktogon from Ilica through its eight-sided glass-domed
// hall to the corner of Margaretska and Bogovićeva. The export cut the doorways into every wall they
// cross; this builds the inside: the side walls, the ceiling (a flat one with strip lights, or a glass
// barrel vault), a floor, the lamps, the Oktogon's hall and dome, and colliders for the walls.
//
// Deliberately cheap: low-resolution textures (public/models/passages/, gen-image redrawings of photos
// of the real interiors), unlit materials, and the lamps' light baked into vertex colours, so the
// passages add no real lights (every light would cost every pixel of the city).

import * as THREE from 'three';
import type RAPIER_NS from '@dimforge/rapier3d-compat';

export interface PassageHall {
  x: number;
  y: number;
  z: number;
  apothem: number;
  /** Bearing of one face's outward normal, degrees clockwise from north. */
  heading: number;
  height: number;
  dome: number;
}

export interface PassageData {
  name: string;
  style: 'maricev' | 'oktogon';
  width: number;
  /** Floor to ceiling, or to the vault's crown. */
  height: number;
  doorWidth: number;
  door: number;
  /** The centreline every metre or so: [x, floor y, z]. */
  samples: [number, number, number][];
  /** Stretches under a roof: [s0, s1, facade direction at s0 (x, z), at s1 (x, z)]. */
  covered: [number, number, number, number, number, number][];
  hall?: PassageHall;
}

type V3 = [number, number, number];
type Lamp = { p: THREE.Vector3; power: number; radius: number };

interface Style {
  wall: string;
  /** The wall picture's width : height, and the height it spans (m). */
  wallAspect: number;
  vault: boolean;
  floor: 'terrazzo' | 'stone';
  /** Light everywhere, and in front of a lamp. */
  ambient: number;
  lampPower: number;
  lampRadius: number;
  lampColor: THREE.Color;
  tint: THREE.Color;
}

const STYLES: Record<PassageData['style'], Style> = {
  maricev: {
    wall: 'mar_wall.jpg', wallAspect: 1.5, vault: false, floor: 'terrazzo',
    ambient: 0.55, lampPower: 1.9, lampRadius: 2.2,
    lampColor: new THREE.Color(0.93, 0.97, 1), tint: new THREE.Color(1, 1, 1),
  },
  oktogon: {
    wall: 'okt_wall.jpg', wallAspect: 1.5, vault: true, floor: 'stone',
    ambient: 1.0, lampPower: 1.3, lampRadius: 2.6,
    lampColor: new THREE.Color(1, 0.86, 0.62), tint: new THREE.Color(1, 0.97, 0.92),
  },
};

const DIR = 'models/passages/';

/** Triangles for one material: positions, uvs and a light level per vertex (baked later). */
class Mesh {
  readonly pos: number[] = [];
  readonly uv: number[] = [];
  /** A fixed light level per vertex, or NaN for "bake from the lamps". */
  readonly fixed: number[] = [];

  tri(a: V3, b: V3, c: V3, ua: [number, number], ub: [number, number], uc: [number, number], light = NaN) {
    this.pos.push(...a, ...b, ...c);
    this.uv.push(...ua, ...ub, ...uc);
    this.fixed.push(light, light, light);
  }

  quad(a: V3, b: V3, c: V3, d: V3, ua: [number, number], ub: [number, number], uc: [number, number], ud: [number, number], light = NaN) {
    this.tri(a, b, c, ua, ub, uc, light);
    this.tri(a, c, d, ua, uc, ud, light);
  }

  geometry(lamps: Lamp[], style: Style) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    const col = new Float32Array(this.pos.length);
    const p = new THREE.Vector3();
    for (let i = 0; i < this.fixed.length; i++) {
      let r: number, gg: number, b: number;
      if (!Number.isNaN(this.fixed[i])) {
        r = gg = b = this.fixed[i];
      } else {
        p.fromArray(this.pos, i * 3);
        r = gg = b = style.ambient;
        for (const l of lamps) {
          const d2 = p.distanceToSquared(l.p);
          const k = (l.power * l.radius * l.radius) / (l.radius * l.radius + d2);
          r += k * style.lampColor.r;
          gg += k * style.lampColor.g;
          b += k * style.lampColor.b;
        }
        r *= style.tint.r;
        gg *= style.tint.g;
        b *= style.tint.b;
      }
      col[i * 3] = r;
      col[i * 3 + 1] = gg;
      col[i * 3 + 2] = b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

function texture(loader: THREE.TextureLoader, url: string, anisotropy: number) {
  const t = loader.load(DIR + url);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = anisotropy;
  return t;
}

/** Terrazzo with a dark grid (Marićev prolaz) or stone slabs (the Oktogon), one tile a metre. */
function floorTexture(kind: Style['floor'], anisotropy: number) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  if (kind === 'terrazzo') {
    g.fillStyle = '#c9c5bb';
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 900; i++) {
      const v = 120 + rnd() * 110;
      g.fillStyle = `rgb(${v},${v - 4},${v - 10})`;
      g.fillRect(rnd() * 128, rnd() * 128, 1 + rnd() * 2, 1 + rnd() * 2);
    }
    g.fillStyle = '#26241f';
    g.fillRect(0, 0, 128, 7);
    g.fillRect(0, 0, 7, 128);
  } else {
    // Four slabs a tile, alternately warm and cool grey, with dark joints.
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 2; i++) {
        const v = (i + j) % 2 ? 150 : 128;
        g.fillStyle = `rgb(${v + 8},${v},${v - 8})`;
        g.fillRect(i * 64, j * 64, 64, 64);
      }
    }
    for (let i = 0; i < 700; i++) {
      g.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '0,0,0'},0.08)`;
      g.fillRect(rnd() * 128, rnd() * 128, 2, 2);
    }
    g.fillStyle = '#3b3530';
    for (const k of [0, 64]) {
      g.fillRect(k, 0, 2, 128);
      g.fillRect(0, k, 128, 2);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = anisotropy;
  return t;
}

/** Arc-length walks along the centreline. */
class Path {
  readonly s: number[] = [0];
  readonly pts: [number, number, number][];
  constructor(pts: [number, number, number][]) {
    this.pts = pts;
    for (let i = 1; i < pts.length; i++) {
      this.s.push(this.s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]));
    }
  }
  get length() {
    return this.s[this.s.length - 1];
  }
  private seg(s: number) {
    let i = 0;
    while (i < this.s.length - 2 && this.s[i + 1] < s) i++;
    return i;
  }
  /** Position (floor height in y) at [s]. */
  at(s: number): THREE.Vector3 {
    const i = this.seg(s);
    const a = this.pts[i], b = this.pts[i + 1];
    const t = Math.min(1, Math.max(0, (s - this.s[i]) / Math.max(1e-6, this.s[i + 1] - this.s[i])));
    return new THREE.Vector3(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
  }
  /** Unit direction (x, z) of travel at [s]. */
  dir(s: number) {
    const i = this.seg(s);
    const a = this.pts[i], b = this.pts[i + 1];
    return new THREE.Vector2(b[0] - a[0], b[2] - a[2]).normalize();
  }
  /** The sample arc lengths strictly between [s0] and [s1]. */
  between(s0: number, s1: number) {
    return this.s.filter((s) => s > s0 + 0.05 && s < s1 - 0.05);
  }
}

/** Left of travel, in the x-z plane. */
const sideOf = (d: THREE.Vector2) => new THREE.Vector2(d.y, -d.x);

export function buildPassages(
  passages: PassageData[],
  R: typeof RAPIER_NS,
  world: RAPIER_NS.World,
  anisotropy: number,
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'passages';
  // The floors lie on the ground as baked (its triangles do not follow the terrain samples exactly):
  // one step builds the query structures, so rays see the city's colliders but none of the walls
  // added below.
  world.step();
  const groundAt = (x: number, z: number, near: number) => {
    const hit = world.castRay(new R.Ray({ x, y: near + 1.2, z }, { x: 0, y: -1, z: 0 }), 3, true, R.QueryFilterFlags.EXCLUDE_DYNAMIC);
    return hit ? near + 1.2 - hit.timeOfImpact : near;
  };
  const loader = new THREE.TextureLoader();
  const cache = new Map<string, THREE.Texture>();
  const tex = (url: string) => {
    if (!cache.has(url)) cache.set(url, texture(loader, url, anisotropy));
    return cache.get(url)!;
  };
  const material = (map: THREE.Texture | null, color = 0xffffff, polygonOffset = false) =>
    new THREE.MeshBasicMaterial({
      map,
      color,
      vertexColors: true,
      side: THREE.DoubleSide,
      polygonOffset,
      polygonOffsetFactor: polygonOffset ? -2 : 0,
      polygonOffsetUnits: polygonOffset ? -2 : 0,
    });
  const wallCollider = (a: THREE.Vector2, b: THREE.Vector2, y0: number, y1: number, outward: THREE.Vector2) => {
    // A 0.3 m slab just outside the wall line a-b.
    const len = a.distanceTo(b);
    if (len < 0.05) return;
    const c = a.clone().add(b).multiplyScalar(0.5).addScaledVector(outward, 0.15);
    const yaw = Math.atan2(-(b.y - a.y), b.x - a.x);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    world.createCollider(
      R.ColliderDesc.cuboid(len / 2 + 0.05, (y1 - y0) / 2, 0.15)
        .setTranslation(c.x, (y0 + y1) / 2, c.y)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setFriction(0.2),
    );
  };

  for (const p of passages) {
    const style = STYLES[p.style];
    const path = new Path(p.samples);
    const lamps: Lamp[] = [];
    const walls = new Mesh(), ceiling = new Mesh(), floor = new Mesh(), glass = new Mesh(), caps = new Mesh();
    const glow = new Mesh(), hallWalls = new Mesh(), hallGates = new Mesh(), dome = new Mesh();
    const w = p.width / 2;
    const spring = style.vault ? p.height - w : p.height;
    const wallRepeat = spring * style.wallAspect;

    // The hall: where the centreline is inside the octagon, the corridor gives way to it.
    const hall = p.hall;
    const hc = hall ? new THREE.Vector2(hall.x, hall.z) : null;
    const normals = hall
      ? Array.from({ length: 8 }, (_, k) => {
          const b = ((hall.heading + 45 * k) * Math.PI) / 180;
          return new THREE.Vector2(Math.sin(b), -Math.cos(b));
        })
      : [];
    const inHall = (s: number) => {
      if (!hall || !hc) return false;
      const q = path.at(s);
      const d = new THREE.Vector2(q.x - hc.x, q.z - hc.y);
      return normals.every((n) => d.dot(n) < hall.apothem);
    };
    // Covered stretches, the hall cut out: [s0, s1, facade dir at s0 or null, at s1 or null, hall face at the end].
    const pieces: { s0: number; s1: number; f0: THREE.Vector2 | null; f1: THREE.Vector2 | null }[] = [];
    let hallArms: number[] = [];
    for (const [s0, s1, f0x, f0z, f1x, f1z] of p.covered) {
      const f0 = new THREE.Vector2(f0x, f0z), f1 = new THREE.Vector2(f1x, f1z);
      if (!hall) {
        pieces.push({ s0, s1, f0, f1 });
        continue;
      }
      // Bisect the hall's edges along this stretch.
      const edges: number[] = [];
      let prev = inHall(s0);
      for (let s = s0 + 0.25; s <= s1 + 1e-6; s += 0.25) {
        const now = inHall(s);
        if (now !== prev) {
          let a = s - 0.25, b = s;
          while (b - a > 0.005) {
            const m = (a + b) / 2;
            if (inHall(m) === prev) a = m;
            else b = m;
          }
          edges.push((a + b) / 2);
        }
        prev = now;
      }
      hallArms = edges;
      const faceAt = (s: number) => {
        const q = path.at(s);
        const d = new THREE.Vector2(q.x - hc!.x, q.z - hc!.y);
        const n = normals.reduce((best, n) => (d.dot(n) > d.dot(best) ? n : best));
        return new THREE.Vector2(-n.y, n.x);
      };
      let start = s0, fs: THREE.Vector2 | null = f0, inside = inHall(s0);
      for (const e of edges) {
        if (!inside) pieces.push({ s0: start, s1: e, f0: fs, f1: faceAt(e) });
        start = e;
        fs = faceAt(e);
        inside = !inside;
      }
      if (!inside) pieces.push({ s0: start, s1, f0: fs, f1 });
    }

    for (const piece of pieces) {
      const stations = [piece.s0, ...path.between(piece.s0, piece.s1), piece.s1];
      // Each station: centre, floor, the left and right wall points.
      const st = stations.map((s, i) => {
        const c = path.at(s);
        const c2 = new THREE.Vector2(c.x, c.z);
        let side: THREE.Vector2;
        let left: THREE.Vector2, right: THREE.Vector2;
        const d = path.dir(Math.min(s + 0.01, path.length));
        const end = i === 0 ? piece.f0 : i === stations.length - 1 ? piece.f1 : null;
        if (end && Math.abs(end.dot(sideOf(d))) > 0.3) {
          // Flush with the facade (or the hall face): along it until w off the centreline.
          const k = w / end.dot(sideOf(d));
          left = c2.clone().addScaledVector(end, k);
          right = c2.clone().addScaledVector(end, -k);
          side = sideOf(d);
        } else {
          // Mitred at a bend.
          const d0 = path.dir(Math.max(0, s - 0.01));
          const n0 = sideOf(d0), n1 = sideOf(d);
          side = n0.clone().add(n1).normalize();
          const m = w / Math.max(0.5, side.dot(n1));
          left = c2.clone().addScaledVector(side, m);
          right = c2.clone().addScaledVector(side, -m);
        }
        return { s, y: c.y, c: c2, side, left, right };
      });

      const rows = Math.max(2, Math.round(spring / 0.9));
      for (let i = 0; i + 1 < st.length; i++) {
        const a = st[i], b = st[i + 1];
        const u0 = a.s / wallRepeat, u1 = b.s / wallRepeat;
        for (const [pa, pb] of [[a.left, b.left], [a.right, b.right]] as const) {
          for (let r = 0; r < rows; r++) {
            const t0 = r / rows, t1 = (r + 1) / rows;
            // The bottom row reaches 0.3 m under the floor.
            const ya0 = a.y + (r === 0 ? -0.3 : spring * t0), yb0 = b.y + (r === 0 ? -0.3 : spring * t0);
            walls.quad(
              [pa.x, ya0, pa.y], [pb.x, yb0, pb.y], [pb.x, b.y + spring * t1, pb.y], [pa.x, a.y + spring * t1, pa.y],
              [u0, r === 0 ? -0.3 / spring : t0], [u1, r === 0 ? -0.3 / spring : t0], [u1, t1], [u0, t1],
            );
          }
        }
        // The floor, a finger above the ground's.
        const on = (q: THREE.Vector2, c: THREE.Vector2, y: number): V3 => [q.x, groundAt(q.x + (c.x - q.x) * 0.02, q.y + (c.y - q.y) * 0.02, y) + 0.03, q.y];
        floor.quad(on(a.left, a.c, a.y), on(b.left, b.c, b.y), on(b.right, b.c, b.y), on(a.right, a.c, a.y), [w, a.s], [w, b.s], [-w, b.s], [-w, a.s]);
        if (style.vault) {
          // A glass barrel vault on the side walls, lit by the sky.
          const n = 8;
          for (let k = 0; k < n; k++) {
            const pt = (st: (typeof a), th: number): V3 => {
              const x = Math.cos(th) * w, y = Math.sin(th) * w;
              const along = st.left.clone().add(st.right).multiplyScalar(0.5);
              const half = st.left.clone().sub(st.right).multiplyScalar(0.5 / w);
              return [along.x + half.x * x, st.y + spring + y, along.y + half.y * x];
            };
            const th0 = (k / n) * Math.PI, th1 = ((k + 1) / n) * Math.PI;
            const v0 = (th0 * w) / 2, v1 = (th1 * w) / 2;
            glass.quad(pt(a, th0), pt(b, th0), pt(b, th1), pt(a, th1), [a.s / 2, v0], [b.s / 2, v0], [b.s / 2, v1], [a.s / 2, v1], 2.3);
          }
        } else {
          const y = p.height;
          ceiling.quad(
            [a.left.x, a.y + y, a.left.y], [b.left.x, b.y + y, b.left.y], [b.right.x, b.y + y, b.right.y], [a.right.x, a.y + y, a.right.y],
            [0, 0], [1, 0], [1, 1], [0, 1],
          );
        }
      }
      // Wall colliders, one slab per straight run.
      for (const side of ['left', 'right'] as const) {
        let from = st[0];
        for (let i = 1; i < st.length; i++) {
          const next = st[i + 1];
          const d0 = st[i][side].clone().sub(from[side]).normalize();
          const bend = next ? Math.abs(next[side].clone().sub(st[i][side]).normalize().cross(d0)) > 0.02 : true;
          if (!bend) continue;
          const mid = from.c.clone().add(st[i].c).multiplyScalar(0.5);
          const out = from[side].clone().add(st[i][side]).multiplyScalar(0.5).sub(mid).normalize();
          wallCollider(from[side], st[i][side], Math.min(from.y, st[i].y) - 0.5, Math.max(from.y, st[i].y) + spring, out);
          from = st[i];
        }
      }
      // Where the corridor meets a facade whose doorway is smaller than the corridor: a cap
      // round the doorway (nothing to see past the facade from inside).
      const hallEnd = (s: number) => hallArms.some((e) => Math.abs(e - s) < 0.01);
      for (const end of [st[0], st[st.length - 1]]) {
        if (hallEnd(end.s) || (p.doorWidth >= p.width - 0.01 && p.door >= p.height - 0.01)) continue;
        const shape = new THREE.Shape();
        shape.moveTo(-w, -0.3);
        shape.lineTo(w, -0.3);
        shape.lineTo(w, spring);
        if (style.vault) shape.absarc(0, spring, w, 0, Math.PI, false);
        else shape.lineTo(-w, spring);
        shape.lineTo(-w, -0.3);
        const hw = p.doorWidth / 2;
        const hole = new THREE.Path();
        hole.moveTo(-hw, 0);
        hole.lineTo(-hw, p.door);
        hole.lineTo(hw, p.door);
        hole.lineTo(hw, 0);
        hole.lineTo(-hw, 0);
        shape.holes.push(hole);
        const sg = new THREE.ShapeGeometry(shape, 12);
        const pos = sg.getAttribute('position');
        const idx = sg.getIndex()!;
        // 8 cm inside the facade: flush with it, the cap would fight it for the pixels round the doorway.
        const into = path.dir(end.s).multiplyScalar(end === st[0] ? 0.08 : -0.08);
        const map = (i: number): V3 => {
          const u = pos.getX(i), v = pos.getY(i);
          // u = +w is the left wall.
          const q = end.c.clone().add(end.left.clone().sub(end.c).multiplyScalar(u / w)).add(into);
          return [q.x, end.y + v, q.y];
        };
        for (let i = 0; i < idx.count; i += 3) {
          const ids = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
          const uv = ids.map((j) => [pos.getX(j) / wallRepeat, pos.getY(j) / spring] as [number, number]);
          caps.tri(map(ids[0]), map(ids[1]), map(ids[2]), uv[0], uv[1], uv[2]);
        }
        sg.dispose();
      }

      // Lamps: strip lights on the ceiling (Marićev) or lanterns hung from the vault's crown
      // (the Oktogon), evenly along the piece.
      const gap = style.vault ? 5.5 : 3.2;
      const n = Math.max(1, Math.floor((piece.s1 - piece.s0) / gap));
      for (let k = 0; k < n; k++) {
        const s = piece.s0 + ((k + 0.5) * (piece.s1 - piece.s0)) / n;
        const c = path.at(s);
        const d = path.dir(s);
        if (style.vault) {
          const y = c.y + p.height - 1.3;
          lamps.push({ p: new THREE.Vector3(c.x, y, c.z), power: style.lampPower, radius: style.lampRadius });
          lantern(glow, c.x, y, c.z, c.y + p.height);
        } else {
          const y = c.y + p.height - 0.03;
          lamps.push({ p: new THREE.Vector3(c.x, y - 0.4, c.z), power: style.lampPower, radius: style.lampRadius });
          strip(glow, c.x, y, c.z, d, 1.25, 0.22);
        }
      }
    }

    if (hall && hc) {
      buildHall(hall, hc, normals, hallArms.map((s) => path.at(s)), style, { hallWalls, hallGates, floor, dome }, lamps, wallCollider, groundAt);
    }

    const floorTex = floorTexture(style.floor, anisotropy);
    const parts: [Mesh, THREE.Material][] = [
      [walls, material(tex(style.wall))],
      [caps, material(tex(style.wall))],
      [floor, material(floorTex, 0xffffff, true)],
      [ceiling, material(null, 0x4a4743)],
      [glass, material(tex('okt_glass.jpg'))],
      [glow, material(null, style.lampColor.getHex())],
      [hallWalls, material(tex('okt_face.jpg'))],
      [hallGates, material(tex('okt_gate.jpg'))],
      [dome, material(tex('okt_dome.jpg'))],
    ];
    for (const [mesh, mat] of parts) {
      if (!mesh.pos.length) {
        mat.dispose();
        continue;
      }
      const m = new THREE.Mesh(mesh.geometry(lamps, style), mat);
      m.name = `${p.name} ${m.id}`;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      root.add(m);
    }
  }
  return root;
}

/** A fluorescent strip on the ceiling at (x, y, z) along [d]. */
function strip(glow: Mesh, x: number, y: number, z: number, d: THREE.Vector2, len: number, wid: number) {
  const s = sideOf(d);
  const p = (a: number, b: number): V3 => [x + d.x * a + s.x * b, y, z + d.y * a + s.y * b];
  const L = len / 2, W = wid / 2;
  glow.quad(p(-L, -W), p(L, -W), p(L, W), p(-L, W), [0, 0], [1, 0], [1, 1], [0, 1], 6);
}

/** A lantern: a warm glowing box on a dark rod down from [top]. */
function lantern(glow: Mesh, x: number, y: number, z: number, top: number) {
  const r = 0.16;
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, light: number) => {
    const c: V3[] = [
      [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
      [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
    ];
    for (const [a, b, cc, d] of [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7], [3, 2, 1, 0]]) {
      glow.quad(c[a], c[b], c[cc], c[d], [0, 0], [1, 0], [1, 1], [0, 1], light);
    }
  };
  box(x - r, x + r, y - r * 1.4, y + r * 1.4, z - r, z + r, 3);
  box(x - 0.015, x + 0.015, y + r * 1.4, top, z - 0.015, z + 0.015, 0.08);
}

/**
 * The Oktogon's hall: eight faces (an arched opening in each face a corridor comes through), a
 * floor, and a glass dome drawn from a picture of the real one taken looking straight up.
 */
function buildHall(
  hall: PassageHall,
  hc: THREE.Vector2,
  normals: THREE.Vector2[],
  arms: THREE.Vector3[],
  style: Style,
  m: { hallWalls: Mesh; hallGates: Mesh; floor: Mesh; dome: Mesh },
  lamps: Lamp[],
  wallCollider: (a: THREE.Vector2, b: THREE.Vector2, y0: number, y1: number, outward: THREE.Vector2) => void,
  groundAt: (x: number, z: number, near: number) => number,
) {
  const a = hall.apothem, H = hall.height, y0 = hall.y;
  const fw = 2 * a * Math.tan(Math.PI / 8);
  // The faces the corridors come through.
  const gates = new Set(
    arms.map((q) => {
      const d = new THREE.Vector2(q.x - hc.x, q.z - hc.y);
      let best = 0;
      normals.forEach((n, k) => {
        if (d.dot(n) > d.dot(normals[best])) best = k;
      });
      return best;
    }),
  );
  // okt_gate.jpg: the arch is 53% of the face wide, springs at 33.5% and peaks at 44% of its height.
  const hw = 0.265 * fw, archSpring = 0.335 * H, archTop = 0.44 * H;
  normals.forEach((n, k) => {
    const t = new THREE.Vector2(-n.y, n.x);
    const f = hc.clone().addScaledVector(n, a);
    const at = (u: number, v: number): V3 => {
      const q = f.clone().addScaledVector(t, u);
      return [q.x, y0 + v, q.y];
    };
    const uvOf = (u: number, v: number): [number, number] => [0.5 - u / fw, v / H];
    if (gates.has(k)) {
      const shape = new THREE.Shape();
      // The opening reaches under the floor (the ground slopes across the hall; no sill).
      shape.moveTo(-fw / 2, -0.6);
      shape.lineTo(fw / 2, -0.6);
      shape.lineTo(fw / 2, H);
      shape.lineTo(-fw / 2, H);
      shape.lineTo(-fw / 2, -0.6);
      const hole = new THREE.Path();
      hole.moveTo(-hw, -0.4);
      hole.lineTo(hw, -0.4);
      hole.lineTo(hw, archSpring);
      hole.absellipse(0, archSpring, hw, archTop - archSpring, 0, Math.PI, false, 0);
      hole.lineTo(-hw, -0.4);
      shape.holes.push(hole);
      const sg = new THREE.ShapeGeometry(shape, 16);
      const pos = sg.getAttribute('position');
      const idx = sg.getIndex()!;
      for (let i = 0; i < idx.count; i += 3) {
        const ids = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
        const [pa, pb, pc] = ids.map((j) => at(pos.getX(j), pos.getY(j)));
        const [ua, ub, uc] = ids.map((j) => uvOf(pos.getX(j), pos.getY(j)));
        m.hallGates.tri(pa, pb, pc, ua, ub, uc);
      }
      sg.dispose();
      // Either side of the arch.
      const l = f.clone().addScaledVector(t, -fw / 2), r = f.clone().addScaledVector(t, fw / 2);
      wallCollider(l, f.clone().addScaledVector(t, -hw), y0 - 0.6, y0 + H, n);
      wallCollider(f.clone().addScaledVector(t, hw), r, y0 - 0.6, y0 + H, n);
    } else {
      // A grid, so the baked light has vertices to land on.
      const cols = 4, rows = 8;
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const u0 = -fw / 2 + (fw * i) / cols, u1 = -fw / 2 + (fw * (i + 1)) / cols;
          const v0 = j === 0 ? -0.3 : (H * j) / rows, v1 = (H * (j + 1)) / rows;
          m.hallWalls.quad(at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1), uvOf(u0, v0), uvOf(u1, v0), uvOf(u1, v1), uvOf(u0, v1));
        }
      }
      wallCollider(f.clone().addScaledVector(t, -fw / 2), f.clone().addScaledVector(t, fw / 2), y0 - 0.5, y0 + H, n);
    }
    // The brass sconces painted on the piers at both ends of each face: their light only.
    for (const u of [-0.4 * fw, 0.4 * fw]) {
      const q = f.clone().addScaledVector(t, u).addScaledVector(n, -0.3);
      lamps.push({ p: new THREE.Vector3(q.x, y0 + 0.25 * H, q.y), power: style.lampPower * 0.8, radius: 2 });
    }
  });
  // Floor: an octagon fan.
  const R = a / Math.cos(Math.PI / 8);
  const corner = (k: number, r: number, y: number): V3 => {
    const b = ((hall.heading + 22.5 + 45 * k) * Math.PI) / 180;
    return [hc.x + Math.sin(b) * r, y, hc.y - Math.cos(b) * r];
  };
  // A polar grid (rings and quarter-sectors), each vertex on the ground.
  const fp = (k: number, r: number): V3 => {
    const k0 = Math.floor(k), f = k - k0;
    const c0 = corner(k0, R * r, 0), c1 = corner(k0 + 1, R * r, 0);
    const x = c0[0] + (c1[0] - c0[0]) * f, z = c0[2] + (c1[2] - c0[2]) * f;
    const q = new THREE.Vector2(x, z).lerp(hc, 0.01);
    return [x, groundAt(q.x, q.y, y0) + 0.03, z];
  };
  const fuv = (q: V3): [number, number] => [q[0] - hc.x, q[2] - hc.y];
  const rings = [0, 0.25, 0.5, 0.75, 1];
  for (let r = 0; r + 1 < rings.length; r++) {
    for (let k = 0; k < 32; k++) {
      const a0 = fp(k / 4, rings[r]), a1 = fp((k + 1) / 4, rings[r]);
      const b0 = fp(k / 4, rings[r + 1]), b1 = fp((k + 1) / 4, rings[r + 1]);
      m.floor.quad(a0, b0, b1, a1, fuv(a0), fuv(b0), fuv(b1), fuv(a1));
    }
  }
  // The dome: rings rising to a small lantern, the picture projected from straight below with
  // its flat top edge on the face at `heading`.
  const h = (hall.heading * Math.PI) / 180;
  const up = new THREE.Vector2(Math.sin(h), -Math.cos(h)), right = new THREE.Vector2(Math.cos(h), Math.sin(h));
  const uv = (q: V3): [number, number] => {
    const d = new THREE.Vector2(q[0] - hc.x, q[2] - hc.y);
    return [0.5 + d.dot(right) / (2 * a), 0.5 + d.dot(up) / (2 * a)];
  };
  const ring = [
    [1, 0],
    [0.8, 0.45],
    [0.55, 0.8],
    [0.14, 1],
  ];
  const top = y0 + H;
  for (let r = 0; r + 1 < ring.length; r++) {
    for (let k = 0; k < 8; k++) {
      const a0 = corner(k, R * ring[r][0], top + hall.dome * ring[r][1]);
      const a1 = corner(k + 1, R * ring[r][0], top + hall.dome * ring[r][1]);
      const b1 = corner(k + 1, R * ring[r + 1][0], top + hall.dome * ring[r + 1][1]);
      const b0 = corner(k, R * ring[r + 1][0], top + hall.dome * ring[r + 1][1]);
      m.dome.quad(a0, a1, b1, b0, uv(a0), uv(a1), uv(b1), uv(b0), 2.6);
    }
  }
  const apex: V3 = [hc.x, top + hall.dome * 1.04, hc.y];
  for (let k = 0; k < 8; k++) {
    const a0 = corner(k, R * 0.14, top + hall.dome), a1 = corner(k + 1, R * 0.14, top + hall.dome);
    m.dome.tri(a0, a1, apex, uv(a0), uv(a1), uv(apex), 2.6);
  }
  // Light falling from the dome.
  lamps.push({ p: new THREE.Vector3(hc.x, top, hc.y), power: 1.2, radius: 7 });
}
