// The Hotel Dubrovnik car park behind Praška ulica 6 (the `parking_lot` item of data/park.json). The ground is
// plain asphalt from the export; this paints the bays on it (one canvas texture on a plane that follows the
// ground by ray casts), parks about 25 instanced cars in them (static cuboid colliders) and stands the blue
// "P" sign at the entrance. Layout is in a bay frame at the item (the lot's north-west corner at its north
// wall): u runs along that wall (7.5 degrees off east), v into the lot (south). Rows, from the wall: A 5 m
// bays, an aisle, B1 + B2 nose to nose, an aisle, C along the south wall. Both aisles meet the street
// driveways. Everything is low-res on purpose.

import * as THREE from 'three';
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PropItem } from './squareprops.ts';

export const PARKING_TYPES = new Set(['parking_lot']);

/** Web frame (x east, z south): the unit vectors of the bay frame. */
const U = new THREE.Vector2(0.9915, 0.13);
const V = new THREE.Vector2(-0.13, 0.9915);

interface Row {
  /** v range of the bays (depth) and the u range they fill. */
  v0: number;
  v1: number;
  u0: number;
  u1: number;
  /** Which way the cars' noses point along V on average (1 into the lot, -1 towards the north wall). */
  nose: 1 | -1;
}

const BAY = 2.5;
const ROWS: Row[] = [
  { v0: 0.6, v1: 5.6, u0: 2, u1: 32, nose: -1 },
  { v0: 11.2, v1: 16.2, u0: 7, u1: 32, nose: -1 },
  { v0: 16.2, v1: 21.2, u0: 7, u1: 32, nose: 1 },
  { v0: 26.4, v1: 31.4, u0: 2, u1: 32, nose: 1 },
];
const CAR_COLOURS = [0xf2f2f0, 0xf2f2f0, 0xe6e6e4, 0x18191c, 0x18191c, 0x2a2d33, 0x8c9096, 0x8c9096, 0xa81f24, 0x2b3f63, 0x5d6b52];

/** A small deterministic generator, so the car park looks the same every visit. */
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

/** One car, nose towards +z, y up from the ground; vertex colours (body white, tinted per instance). */
function carGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (w: number, h: number, d: number, x: number, y: number, z: number, shade: number) => {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    g.translate(x, y + h / 2, z);
    const n = g.attributes.position.count;
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(shade), 3));
    g.deleteAttribute('uv');
    parts.push(g);
  };
  add(1.76, 0.62, 4.25, 0, 0.3, 0, 1); // body
  add(1.5, 0.5, 2.1, 0, 0.92, -0.25, 0.18); // glass cabin
  add(1.46, 0.06, 1.9, 0, 1.42, -0.25, 0.92); // roof
  for (const sx of [-0.86, 0.86]) for (const sz of [-1.35, 1.35]) add(0.22, 0.6, 0.6, sx, 0, sz, 0.02);
  return mergeGeometries(parts, false);
}

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

export class ParkingLot {
  readonly root = new THREE.Group();
  private colliders = 0;
  private cars = 0;

  private readonly R: typeof RAPIER_NS;
  private readonly world: RAPIER_NS.World;

  constructor(items: PropItem[], R: typeof RAPIER_NS, world: RAPIER_NS.World) {
    this.R = R;
    this.world = world;
    this.root.name = 'parking';
    try {
      for (const it of items) this.lot(it);
      console.log(`[zg] parking: ${this.cars} cars, ${this.colliders} colliders`);
    } catch (e) {
      console.error('[zg] parking failed', e);
    }
  }

  private groundY(x: number, z: number, y0: number): number {
    const fixed = this.R.QueryFilterFlags.EXCLUDE_DYNAMIC | this.R.QueryFilterFlags.EXCLUDE_KINEMATIC;
    const hit = this.world.castRay(new this.R.Ray({ x, y: y0 + 4, z }, { x: 0, y: -1, z: 0 }), 12, true, fixed);
    return hit ? y0 + 4 - hit.timeOfImpact : y0;
  }

  private lot(it: PropItem) {
    const at = (u: number, v: number) => ({ x: it.x + U.x * u + V.x * v, z: it.z + U.y * u + V.y * v });
    this.world.step();
    this.markings(it, at);
    this.carsIn(it, at);
    this.sign(it, at);
  }

  private markings(it: PropItem, at: (u: number, v: number) => { x: number; z: number }) {
    const u0 = -3, u1 = 36, v0 = -0.5, v1 = 34;
    const ppm = 32;
    const W = (u1 - u0) * ppm, H = (v1 - v0) * ppm;
    const r = rng(77);
    const tex = canvasTex(Math.round(W), Math.round(H), (c) => {
      const X = (u: number) => (u - u0) * ppm;
      const Y = (v: number) => (v - v0) * ppm;
      // Oil stains and tyre-dark patches along the aisles.
      for (let i = 0; i < 40; i++) {
        c.fillStyle = `rgba(10,10,12,${0.05 + r() * 0.08})`;
        c.beginPath();
        c.ellipse(X(2 + r() * 32), Y(5.6 + r() * 20), (0.3 + r() * 1.2) * ppm, (0.2 + r() * 0.7) * ppm, r() * 3, 0, Math.PI * 2);
        c.fill();
      }
      c.strokeStyle = 'rgba(236,236,228,0.88)';
      c.lineWidth = 0.1 * ppm;
      c.lineCap = 'butt';
      const line = (ua: number, va: number, ub: number, vb: number) => {
        c.beginPath();
        c.moveTo(X(ua), Y(va));
        c.lineTo(X(ub), Y(vb));
        c.stroke();
      };
      ROWS.forEach((row, k) => {
        const n = Math.floor((row.u1 - row.u0) / BAY);
        for (let b = 0; b <= n; b++) line(row.u0 + b * BAY, row.v0, row.u0 + b * BAY, row.v1);
        // The front edge of the bays facing an aisle, the back line of the double row.
        if (k === 0) line(row.u0, row.v1, row.u0 + n * BAY, row.v1);
        if (k === 2) line(row.u0, row.v0, row.u0 + n * BAY, row.v0);
        if (k === 3) line(row.u0, row.v0, row.u0 + n * BAY, row.v0);
        if (k === 1) line(row.u0, row.v0, row.u0 + n * BAY, row.v0);
      });
      // The hatched no-parking patch at the east end of the middle aisle.
      c.lineWidth = 0.12 * ppm;
      for (let q = 0; q < 4; q++) line(33.2, 5.8 + q * 1.3, 35.4, 7.0 + q * 1.3);
    });
    const nu = 39, nv = 34;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const u = u0 + ((u1 - u0) * i) / nu, v = v0 + ((v1 - v0) * j) / nv;
        const p = at(u, v);
        pos.push(p.x, this.groundY(p.x, p.z, it.y) + 0.03, p.z);
        uv.push(i / nu, 1 - j / nv);
      }
    }
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(
      g,
      new THREE.MeshStandardMaterial({
        map: tex, transparent: true, depthWrite: false, roughness: 0.95,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      }),
    );
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    this.root.add(mesh);
  }

  private carsIn(it: PropItem, at: (u: number, v: number) => { x: number; z: number }) {
    const r = rng(2024);
    const spots: { x: number; z: number; yaw: number; colour: number }[] = [];
    const base = Math.atan2(V.x, V.y);
    for (const row of ROWS) {
      const n = Math.floor((row.u1 - row.u0) / BAY);
      for (let b = 0; b < n; b++) {
        if (r() > 0.62) continue;
        const u = row.u0 + (b + 0.5) * BAY + (r() - 0.5) * 0.3;
        // Cars sit towards the back of the bay (nose out for half of them).
        const out = r() < 0.5 ? row.nose : -row.nose;
        const v = (row.v0 + row.v1) / 2 + (r() - 0.5) * 0.5;
        const p = at(u, v);
        spots.push({ x: p.x, z: p.z, yaw: base + (out > 0 ? 0 : Math.PI) + (r() - 0.5) * 0.07, colour: CAR_COLOURS[Math.floor(r() * CAR_COLOURS.length)] });
      }
    }
    const mesh = new THREE.InstancedMesh(
      carGeometry(),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.25 }),
      spots.length,
    );
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
    const col = new THREE.Color();
    spots.forEach((p, i) => {
      const y = this.groundY(p.x, p.z, it.y);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw);
      m.compose(new THREE.Vector3(p.x, y + 0.03, p.z), q, s);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, col.setHex(p.colour));
      this.world.createCollider(
        this.R.ColliderDesc.cuboid(0.9, 0.7, 2.15)
          .setTranslation(p.x, y + 0.7, p.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
      );
      this.colliders++;
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.cars = spots.length;
    this.root.add(mesh);
  }

  /** The blue "P" board on a pole at the street end of the north wall. */
  private sign(it: PropItem, at: (u: number, v: number) => { x: number; z: number }) {
    const p = at(-1.2, 1.4);
    const y = this.groundY(p.x, p.z, it.y);
    const tex = canvasTex(256, 384, (c) => {
      c.fillStyle = '#17458f';
      c.fillRect(0, 0, 256, 384);
      c.strokeStyle = '#ffffff';
      c.lineWidth = 8;
      c.strokeRect(10, 10, 236, 364);
      c.fillStyle = '#fff';
      c.font = 'bold 230px Arial, Helvetica, sans-serif';
      c.textAlign = 'center';
      c.fillText('P', 128, 235);
      c.font = 'bold 30px Arial, Helvetica, sans-serif';
      c.fillText('HOTEL', 128, 292);
      c.fillText('DUBROVNIK', 128, 330);
    });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.9, 8), new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.6 }));
    pole.position.set(p.x, y + 1.45, p.z);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.35), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }));
    board.position.set(p.x, y + 2.25, p.z);
    // It faces west, towards Praška ulica.
    board.rotation.y = -Math.PI / 2;
    const back = board.clone();
    back.rotation.y = Math.PI / 2;
    back.position.x += 0.02;
    board.position.x -= 0.02;
    for (const o of [pole, board, back]) {
      o.castShadow = true;
      this.root.add(o);
    }
    this.world.createCollider(this.R.ColliderDesc.cylinder(1.45, 0.06).setTranslation(p.x, y + 1.45, p.z));
    this.colliders++;
  }
}
