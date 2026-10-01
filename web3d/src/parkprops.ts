// The small park on Ulica Augusta Cesarca (Park međunarodnog priznanja Republike Hrvatske), pieces from
// data/park.json: `eu_garden` (the ring of twelve yellow stars on the lawn, with its two glass skylights
// and two stone plaques) and `wc_stairs` (the closed underground public toilet: a stairwell sunk into
// the lawn by the two 'WC stairwell' regions of data/levels.json, a blocked gate and railings round it,
// the steel-and-glass lift beside it). Items sit at web x, z with the ground height at y; headings are
// ignored (both face north). Local offsets are metres from the item: x east, z south, y above it.
// Everything is low-res on purpose: flat colours, one canvas texture a piece.

import * as THREE from 'three';
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PropItem } from './squareprops.ts';

export const PARK_TYPES = new Set(['eu_garden', 'wc_stairs', 'funicular']);

interface Part {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
}

const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Box centred on (x, z), bottom at y0. */
function box(w: number, h: number, d: number, x: number, y0: number, z: number, rotY = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.rotateY(rotY);
  g.translate(x, y0 + h / 2, z);
  return g;
}

function post(x: number, y0: number, z: number, h: number, r = 0.03): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, h, 6);
  g.translate(x, y0 + h / 2, z);
  return g;
}

/** A horizontal round bar from (x0, z0) to (x1, z1) at height y. */
function bar(x0: number, z0: number, x1: number, z1: number, y: number, r = 0.022): THREE.BufferGeometry {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const g = new THREE.CylinderGeometry(r, r, len, 6);
  g.rotateZ(Math.PI / 2);
  g.rotateY(-Math.atan2(z1 - z0, x1 - x0));
  g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  return g;
}

function flat(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const o = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(o.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') o.deleteAttribute(k);
  return o;
}

export class ParkProps {
  readonly root = new THREE.Group();
  private colliders = 0;

  private readonly items: PropItem[];
  private readonly R: typeof RAPIER_NS;
  private readonly world: RAPIER_NS.World;

  constructor(items: PropItem[], R: typeof RAPIER_NS, world: RAPIER_NS.World) {
    this.items = items;
    this.R = R;
    this.world = world;
    this.root.name = 'parkprops';
    try {
      this.build();
    } catch (e) {
      console.error('[zg] parkprops failed', e);
    }
  }

  /** Height of the static ground / floor under web (x, z), looking down from y0 + 8; null if there is none. */
  private groundY(x: number, z: number, y0: number): number | null {
    const fixed = this.R.QueryFilterFlags.EXCLUDE_DYNAMIC | this.R.QueryFilterFlags.EXCLUDE_KINEMATIC;
    const hit = this.world.castRay(new this.R.Ray({ x, y: y0 + 8, z }, { x: 0, y: -1, z: 0 }), 20, true, fixed);
    return hit ? y0 + 8 - hit.timeOfImpact : null;
  }

  private cuboid(it: PropItem, hx: number, hy: number, hz: number, lx: number, ly: number, lz: number) {
    const desc = this.R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(it.x + lx, it.y + ly, it.z + lz);
    this.world.createCollider(desc);
    this.colliders++;
  }

  private add(parts: Part[], it: PropItem, noShadow = false) {
    const by = new Map<THREE.Material, THREE.BufferGeometry[]>();
    for (const p of parts) {
      const list = by.get(p.mat) ?? [];
      list.push(flat(p.geo));
      by.set(p.mat, list);
    }
    for (const [mat, list] of by) {
      const mesh = new THREE.Mesh(mergeGeometries(list, false), mat);
      mesh.position.set(it.x, it.y, it.z);
      mesh.castShadow = !noShadow;
      mesh.receiveShadow = true;
      this.root.add(mesh);
    }
  }

  private build() {
    this.world.step();
    for (const it of this.items) {
      if (it.type === 'eu_garden') this.garden(it);
      else if (it.type === 'wc_stairs') this.wcStairs(it);
      else if (it.type === 'funicular') this.funicular(it);
    }
    console.log(`[zg] park props: ${this.items.length} items, ${this.colliders} colliders`);
  }

  // ---- the Zagreb funicular (Uspinjača) --------------------------------------------------------
  // From the lower station's back wall (the item, web x, z) up the slope to the upper station at
  // (toX, toZ): two tracks on a gravel bed, a cabin on each (a stepped blue body on a sloping chassis)
  // and a small upper station. The street is closed by a roadblock, so this is scenery seen from
  // far: flat colours, no colliders. Track heights are ray-cast from the ground.

  private funicular(it: PropItem) {
    const toX = it.toX as number, toZ = it.toZ as number;
    const N = 36;
    const fixed = this.R.QueryFilterFlags.EXCLUDE_DYNAMIC | this.R.QueryFilterFlags.EXCLUDE_KINEMATIC;
    const ground = (x: number, z: number) => {
      const hit = this.world.castRay(new this.R.Ray({ x, y: it.y + 60, z }, { x: 0, y: -1, z: 0 }), 90, true, fixed);
      return hit ? it.y + 60 - hit.timeOfImpact : it.y;
    };
    // axis samples in local metres, heights smoothed so the track is a clean slope
    const ax: number[] = [], az: number[] = [], ay: number[] = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      ax.push((toX - it.x) * t);
      az.push((toZ - it.z) * t);
      ay.push(ground(it.x + ax[i], it.z + az[i]) - it.y);
    }
    const sm = ay.map((_, i) => {
      let sum = 0, c = 0;
      for (let k = -3; k <= 3; k++) if (ay[i + k] !== undefined) { sum += ay[i + k]; c++; }
      return sum / c;
    });
    const dir = new THREE.Vector3(toX - it.x, 0, toZ - it.z).normalize();
    const side = new THREE.Vector3(dir.z, 0, -dir.x); // to the right of the way up
    const yaw = Math.atan2(dir.x, dir.z);
    const at = (s: number, off: number): THREE.Vector3 => {
      const f = Math.min(N, Math.max(0, s * N)), i = Math.min(N - 1, Math.floor(f)), u = f - i;
      return new THREE.Vector3(
        ax[i] + (ax[i + 1] - ax[i]) * u + side.x * off,
        sm[i] + (sm[i + 1] - sm[i]) * u,
        az[i] + (az[i + 1] - az[i]) * u + side.z * off,
      );
    };
    // a box of w x h x l, centred on a point on the track, its long axis along the slope
    const along = (w: number, h: number, l: number, s0: number, s1: number, off: number, up: number, shift = 0) => {
      const a = at(s0, off + shift), b = at(s1, off + shift);
      const g = new THREE.BoxGeometry(w, h, l ?? a.distanceTo(b));
      const o = new THREE.Object3D();
      o.position.copy(a).add(b).multiplyScalar(0.5);
      o.position.y += up;
      o.lookAt(o.position.clone().add(b.clone().sub(a)));
      o.updateMatrix();
      g.applyMatrix4(o.matrix);
      return g;
    };

    const gravel = std({ color: 0x77716a, roughness: 1 });
    const steelM = std({ color: 0x6b6f73, roughness: 0.5, metalness: 0.6 });
    const sleeperM = std({ color: 0x4a3f36, roughness: 1 });
    const blue = std({ color: 0x2c5f9d, roughness: 0.6 });
    const cream = std({ color: 0xd9ceb0, roughness: 0.9 });
    const glassM = std({ color: 0x1d2a35, roughness: 0.2, metalness: 0.3 });
    const roofM = std({ color: 0x555a5e, roughness: 0.8 });
    const wall = std({ color: 0xcdbf9f, roughness: 0.95 });
    const parts: Part[] = [];

    for (let i = 0; i < N; i++) {
      const s0 = i / N, s1 = (i + 1) / N;
      const len = at(s0, 0).distanceTo(at(s1, 0)) + 0.05;
      parts.push({ geo: along(8.2, 0.3, len, s0, s1, 0, -0.1), mat: gravel });
      for (const tr of [-1.7, 1.7]) {
        for (const r of [-0.6, 0.6]) parts.push({ geo: along(0.1, 0.14, len, s0, s1, tr + r, 0.25), mat: steelM });
        parts.push({ geo: along(2.0, 0.1, 0.3, s0, s0 + 0.001, tr, 0.12), mat: sleeperM });
      }
    }
    // a cabin on each track: three stepped compartments on a sloping chassis
    const cabin = (tr: number, s: number) => {
      const c = at(s, tr);
      const half = 0.045;
      parts.push({ geo: along(2.3, 0.28, 8.0, s - half, s + half, tr, 0.6), mat: roofM });
      for (let k = -1; k <= 1; k++) {
        const p = at(s + k * 0.042, tr);
        const y0 = p.y + 0.75;
        const body = box(2.3, 2.2, 2.45, p.x, y0, p.z, yaw);
        parts.push({ geo: body, mat: blue });
        const win = box(2.34, 0.8, 2.0, p.x, y0 + 0.9, p.z, yaw);
        parts.push({ geo: win, mat: glassM });
        parts.push({ geo: box(2.5, 0.12, 2.65, p.x, y0 + 2.2, p.z, yaw), mat: roofM });
      }
      return c;
    };
    cabin(-1.7, 0.30);
    cabin(1.7, 0.70);

    // the upper station
    const top = at(1, 0);
    const ux = top.x + dir.x * 4.5, uz = top.z + dir.z * 4.5;
    parts.push({ geo: box(9, 4.6, 7.5, ux, top.y - 0.5, uz, yaw), mat: wall });
    parts.push({ geo: box(9.4, 0.3, 7.9, ux, top.y + 4.1, uz, yaw), mat: roofM });
    parts.push({ geo: box(4.2, 2.6, 0.12, top.x + dir.x * 0.7, top.y, top.z + dir.z * 0.7, yaw), mat: glassM });
    this.add(parts, it);
    console.log('[zg] funicular: ' + parts.length + ' parts');
  }

  // ---- the ring of stars ---------------------------------------------------------------------

  private garden(it: PropItem) {
    const R0 = 3.6;
    const bed = canvasTex(512, 512, (c) => {
      c.fillStyle = '#3a6a2c';
      c.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 1600; i++) {
        c.fillStyle = i % 3 ? '#2f5a25' : '#476f33';
        c.fillRect(Math.random() * 512, Math.random() * 512, 5, 5);
      }
      c.strokeStyle = '#25461d';
      c.lineWidth = 10;
      c.beginPath();
      c.arc(256, 256, 250, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = '#f1cd2a';
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const cx = 256 + Math.cos(a) * 190;
        const cy = 256 + Math.sin(a) * 190;
        c.save();
        c.translate(cx, cy);
        c.rotate(a + Math.PI / 2);
        c.beginPath();
        for (let p = 0; p < 10; p++) {
          const r = p % 2 ? 11 : 30;
          const t = (p / 10) * Math.PI * 2 - Math.PI / 2;
          c.lineTo(Math.cos(t) * r, Math.sin(t) * r);
        }
        c.closePath();
        c.fill();
        c.restore();
      }
    });
    const disc = new THREE.RingGeometry(0.001, R0, 56, 7);
    disc.rotateX(-Math.PI / 2);
    const pos = disc.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const g = this.groundY(it.x + pos.getX(i), it.z + pos.getZ(i), it.y) ?? it.y;
      pos.setY(i, g - it.y + 0.05);
    }
    disc.computeVertexNormals();
    const mat = std({ map: bed, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.add([{ geo: disc, mat }], it, true);

    // two skylights over the museum below (zinc frame, dark glass) and two stone plaques
    const frame = std({ color: 0x55595c, roughness: 0.5, metalness: 0.5 });
    const glass = std({ color: 0x23383c, roughness: 0.12, metalness: 0.3 });
    const stone = std({ color: 0xb7b2a6, roughness: 0.9 });
    const parts: Part[] = [];
    const lay = (lx: number, lz: number, rot: number, w: number, d: number, m1: THREE.Material, m2: THREE.Material | null, h: number) => {
      const g = this.groundY(it.x + lx, it.z + lz, it.y) ?? it.y;
      const y0 = g - it.y;
      parts.push({ geo: box(w, h + 0.3, d, lx, y0 - 0.3, lz, rot), mat: m1 });
      if (m2) parts.push({ geo: box(w - 0.22, 0.03, d - 0.22, lx, y0 + h, lz, rot), mat: m2 });
    };
    lay(-5.0, 2.3, -0.5, 4.6, 0.95, frame, glass, 0.12);
    lay(4.6, -1.9, -0.5, 4.6, 0.95, frame, glass, 0.12);
    lay(-0.6, 4.5, 0, 0.7, 0.5, stone, null, 0.05);
    lay(3.1, 4.1, 0, 0.7, 0.5, stone, null, 0.05);
    this.add(parts, it, true);
  }

  // ---- the closed toilet: stairwell, gate, lift ---------------------------------------------

  private wcStairs(it: PropItem) {
    const W = 1.4; // half the pit width
    const yTop = this.groundY(it.x, it.z - 0.05, it.y) ?? it.y;
    const yBot = this.groundY(it.x, it.z - 4.95, it.y) ?? it.y - 3;
    const yFloor = this.groundY(it.x, it.z - 6.3, it.y) ?? yBot;
    const y0 = yTop - it.y;
    const concrete = std({ color: 0xaaa69c, roughness: 0.95 });
    const dark = std({ color: 0x2b2e30, roughness: 0.7, metalness: 0.4 });
    const steel = std({ color: 0x9ba0a4, roughness: 0.35, metalness: 0.8 });
    const teal = std({ color: 0x4f9a96, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
    const tealSolid = std({ color: 0x3b7f7c, roughness: 0.4, metalness: 0.4 });
    const doorMat = std({ color: 0x43524a, roughness: 0.6, metalness: 0.4 });
    const parts: Part[] = [];

    // steps: stepped concrete laid just above the ground mesh's own ramp
    const n = Math.max(8, Math.round((yTop - yBot) / 0.17));
    const rise = (yTop - yBot) / n;
    const tread = 5 / n;
    for (let i = 0; i < n; i++) {
      const top = yTop - i * rise + 0.09 - it.y;
      parts.push({ geo: box(2 * W, top - (yBot - it.y) + 0.3, tread + 0.005, 0, yBot - it.y - 0.3, -(i + 0.5) * tread), mat: concrete });
    }
    // landing floor, the door to the toilets and its sign
    const fl = yFloor - it.y;
    parts.push({ geo: box(2 * W, 0.35, 2.6, 0, fl - 0.3, -6.3), mat: concrete });
    parts.push({ geo: box(1.1, 2.1, 0.08, 0.2, fl + 0.05, -7.55), mat: doorMat });
    parts.push({ geo: box(1.1, 0.06, 0.1, 0.2, fl + 2.15, -7.55), mat: dark });
    const wc = canvasTex(128, 128, (c) => {
      c.fillStyle = '#1d4fa0';
      c.fillRect(0, 0, 128, 128);
      c.fillStyle = '#fff';
      c.font = 'bold 70px sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('WC', 64, 68);
    });
    const wcMat = std({ map: wc, roughness: 0.6 });
    parts.push({ geo: box(0.5, 0.5, 0.05, 0.2, fl + 2.35, -7.5), mat: wcMat });

    // railings round the pit; the stair head is shut by a gate with a "closed" plate and tape
    const rx = W + 0.3;
    const zH = 0.35;
    const zN = -7.95;
    const rail = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const k = Math.max(1, Math.round(len / 1.3));
      for (let i = 0; i <= k; i++) parts.push({ geo: post(x0 + ((x1 - x0) * i) / k, y0 - 0.1, z0 + ((z1 - z0) * i) / k, 1.15), mat: steel });
      for (const h of [0.45, 0.8, 1.1]) parts.push({ geo: bar(x0, z0, x1, z1, y0 + h), mat: steel });
    };
    rail(-rx, zH, -rx, zN);
    rail(rx, zH, rx, zN);
    rail(-rx, zN, rx, zN);
    rail(-rx, zH, rx, zH);
    // gate leaf: vertical bars between a top and bottom rail
    for (let i = 0; i <= 14; i++) parts.push({ geo: post(-rx + ((2 * rx) * i) / 14, y0 + 0.1, zH, 0.95, 0.015), mat: dark });
    const closed = canvasTex(256, 64, (c) => {
      c.fillStyle = '#f2f0ea';
      c.fillRect(0, 0, 256, 64);
      c.strokeStyle = '#b3201c';
      c.lineWidth = 4;
      c.strokeRect(3, 3, 250, 58);
      c.fillStyle = '#b3201c';
      c.font = 'bold 34px sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('ZATVORENO', 128, 34);
    });
    parts.push({ geo: box(1.1, 0.3, 0.03, 0, y0 + 0.55, zH + 0.04), mat: std({ map: closed, roughness: 0.6 }) });
    const tapeTex = canvasTex(256, 16, (c) => {
      for (let i = 0; i < 16; i++) {
        c.fillStyle = i % 2 ? '#d4261f' : '#f4f4f4';
        c.fillRect(i * 16, 0, 16, 16);
      }
    });
    tapeTex.wrapS = THREE.RepeatWrapping;
    parts.push({ geo: box(2 * rx, 0.08, 0.01, 0, y0 + 0.95, zH + 0.06), mat: std({ map: tapeTex, roughness: 0.8 }) });

    // the lift: steel frame, teal glass, teal roof, door on its east face
    const lz = 2.5;
    const ly = (this.groundY(it.x, it.z + lz, it.y) ?? yTop) - it.y;
    parts.push({ geo: box(2.0, 0.4, 2.0, 0, ly - 0.3, lz), mat: concrete });
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) parts.push({ geo: box(0.08, 2.6, 0.08, sx * 0.88, ly + 0.1, lz + sz * 0.88), mat: steel });
    parts.push({ geo: box(1.76, 2.4, 0.03, 0, ly + 0.2, lz - 0.88), mat: teal });
    parts.push({ geo: box(1.76, 2.4, 0.03, 0, ly + 0.2, lz + 0.88), mat: teal });
    parts.push({ geo: box(0.03, 2.4, 1.76, -0.88, ly + 0.2, lz), mat: teal });
    parts.push({ geo: box(0.03, 2.4, 1.76, 0.88, ly + 0.2, lz), mat: teal });
    parts.push({ geo: box(0.05, 2.2, 1.0, 0.9, ly + 0.2, lz), mat: steel });
    parts.push({ geo: box(2.15, 0.16, 2.15, 0, ly + 2.7, lz), mat: tealSolid });
    parts.push({ geo: box(2.0, 0.06, 2.0, 0, ly + 2.86, lz), mat: steel });
    this.add(parts, it);

    // solid: the lift, the railings and the gate (thick enough that nothing tunnels through)
    this.cuboid(it, 1.0, 1.4, 1.0, 0, ly + 1.4, lz);
    this.cuboid(it, 0.15, 0.7, 4.2, -rx, y0 + 0.7, (zH + zN) / 2);
    this.cuboid(it, 0.15, 0.7, 4.2, rx, y0 + 0.7, (zH + zN) / 2);
    this.cuboid(it, rx, 0.7, 0.15, 0, y0 + 0.7, zH);
    this.cuboid(it, rx, 0.7, 0.15, 0, y0 + 0.7, zN);
  }
}
