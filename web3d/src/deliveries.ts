// Delivery jobs: you carry a package to a business, whose name shows at once and whose street
// follows STREET_DELAY seconds later. Every business in data/deliveries.json (copied to
// public/city/ by sync-assets.mjs) has a pale yellow pad on the floor in front of its entrance;
// the current job's pad pulses. Driving onto it (slowly enough) delivers and rolls the next job.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const STREET_DELAY = 5;
/** A run is this many deliveries; after the last one there is no next job. */
export const TOTAL_JOBS = 8;
/** Metres from the pad's centre that count as arriving, and the top speed (m/s) to deliver at. */
const ARRIVE_RADIUS = 2.4;
const ARRIVE_SPEED = 9;
/** Metres a pad floats over the ground under each of its vertices. */
const PAD_LIFT = 0.05;

/** One entry of data/deliveries.json. Either a wall (`wall` id, `at` 0..1 along it from end a, `out` metres
 *  in front, default 1.1) or a free spot in the tool frame (`x`, `z` north, `y` floor height for interiors). */
interface Entry {
  id: string;
  name: string;
  street: string;
  wall?: string;
  at?: number;
  out?: number;
  x?: number;
  z?: number;
  y?: number;
  /** For x/z spots without `y`: the absolute height to cast down from (default 3 m over the terrain; higher on a plateau). */
  probe?: number;
  /** Pad radius in metres (default 1.0). */
  radius?: number;
  note?: string;
}

export interface Destination {
  id: string;
  name: string;
  street: string;
  pos: THREE.Vector3;
  radius: number;
}

type Walls = Record<string, number[]>;
/** The playable area: city.json `extent` [minX, minZ, maxX, maxZ] and `blocked` boxes, web frame. */
export interface Bounds {
  extent: number[];
  blocked: number[][];
}

/** Height of the first static surface under (x, z), cast down from [from]; null when there is none. */
type Ground = (x: number, z: number, from: number) => number | null;
/** The bare terrain height at (x, z): where the street roughly is, whatever the wall's sidewalk says. */
type Terrain = (x: number, z: number) => number;

function resolve(e: Entry, walls: Walls, ground: Ground, terrain: Terrain, bounds: Bounds): Destination | null {
  let x: number, z: number, y: number | null = e.y ?? null;
  if (e.wall) {
    const w = walls[e.wall];
    if (!w) {
      console.warn(`[deliveries] ${e.id}: wall ${e.wall} is not in the playable city`);
      return null;
    }
    const [ax, az, bx, bz, nx, nz, sidewalk] = w;
    const s = e.at ?? 0.5;
    const out = e.out ?? 1.1;
    x = ax + (bx - ax) * s + nx * out;
    z = az + (bz - az) * s + nz * out;
    // From above the street, not just the wall's sidewalk height: on a slope that can lie a metre
    // under the door, and a ray starting under the pavement sank the pad with it.
    y ??= ground(x, z, Math.max(sidewalk, terrain(x, z)) + 1.5) ?? sidewalk;
  } else if (e.x !== undefined && e.z !== undefined) {
    x = e.x;
    z = -e.z; // the data is in the tool frame (z north); the web frame is z south
    y ??= ground(x, z, e.probe ?? terrain(x, z) + 3) ?? terrain(x, z);
  } else {
    console.warn(`[deliveries] ${e.id}: needs a wall or x/z`);
    return null;
  }
  const [x0, z0, x1, z1] = bounds.extent;
  if (x < x0 || x > x1 || z < z0 || z > z1 || bounds.blocked.some((b) => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3])) {
    console.warn(`[deliveries] ${e.id}: outside the playable area, skipped`);
    return null;
  }
  return { id: e.id, name: e.name, street: e.street, pos: new THREE.Vector3(x, y, z), radius: e.radius ?? 1.0 };
}

export class Deliveries {
  readonly destinations: Destination[] = [];
  /** Each pad's draped disc and ring, round its centre. */
  private pads: { disc: THREE.BufferGeometry; ring: THREE.BufferGeometry }[] = [];
  /** Every pad but the current one, as two meshes (one draw call each instead of two per pad): pad i
   * owns index range i * count of each, collapsed while it is the current job. */
  private all: { mesh: THREE.Mesh; full: ArrayLike<number>; count: number }[] = [];
  /** The current job's pad, pulsing. */
  private active = new THREE.Group();
  private hidden = -1;
  private material = new THREE.MeshBasicMaterial({
    color: 0xf6e9a6,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  private activeMaterial = this.material.clone();
  readonly root = new THREE.Group();

  current: Destination | null = null;
  /** Seconds since the current job started. */
  age = 0;
  delivered = 0;
  /** Set for one update() call when a package has just been handed over. */
  justDelivered: Destination | null = null;
  private time = 0;

  constructor(entries: Entry[], walls: Walls, ground: Ground, terrain: Terrain, bounds: Bounds) {
    for (const e of entries) {
      const d = resolve(e, walls, ground, terrain, bounds);
      if (d) this.destinations.push(d);
    }
    // A pad is a disc with a slightly stronger ring, so it reads on cobbles and asphalt alike. Pads
    // drape over the ground (a flat disc sank into a slope or a kerb with part of it), so the disc
    // has rings of vertices inside as well as on its rim.
    const disc = new THREE.RingGeometry(0, 1, 40, 6).rotateX(-Math.PI / 2);
    const ring = new THREE.RingGeometry(0.86, 1, 40, 1).rotateX(-Math.PI / 2);
    this.activeMaterial.opacity = 0.8;
    for (const d of this.destinations) {
      // The ground under every vertex (relative to the centre), keyed by position: the two meshes
      // share the rim and the disc's centre is 41 vertices.
      const raw = new Map<string, number>();
      const near = new Map<string, Set<string>>();
      const keysOf = (template: THREE.BufferGeometry) => {
        const pos = template.getAttribute('position');
        const keys: string[] = [];
        for (let k = 0; k < pos.count; k++) {
          const x = pos.getX(k) * d.radius, z = pos.getZ(k) * d.radius;
          const key = `${x.toFixed(3)},${z.toFixed(3)}`;
          keys.push(key);
          if (raw.has(key)) continue;
          const hit = ground(d.pos.x + x, d.pos.z + z, d.pos.y + 1);
          // Nothing within a metre and a half below (over a drop): stay level with the centre.
          raw.set(key, hit === null || hit < d.pos.y - 1.5 ? 0 : hit - d.pos.y);
        }
        const index = template.getIndex()!;
        for (let t = 0; t < index.count; t += 3) {
          for (let e = 0; e < 3; e++) {
            const a = keys[index.getX(t + e)], b = keys[index.getX(t + ((e + 1) % 3))];
            if (!near.has(a)) near.set(a, new Set());
            if (!near.has(b)) near.set(b, new Set());
            near.get(a)!.add(b);
            near.get(b)!.add(a);
          }
        }
        return keys;
      };
      // A kerb under a pad poked its edge through between two vertices in a jagged line: every vertex
      // rises to its highest neighbour up to a kerb's height away, so the pad bridges such steps.
      const height = (key: string) => {
        let h = raw.get(key)!;
        for (const n of near.get(key) ?? []) {
          const hn = raw.get(n)!;
          if (hn > h && hn - h < 0.3) h = hn;
        }
        return h;
      };
      const drape = (template: THREE.BufferGeometry, keys: string[]) => {
        const g = template.clone();
        const pos = g.getAttribute('position');
        for (let k = 0; k < pos.count; k++) {
          pos.setXYZ(k, pos.getX(k) * d.radius, height(keys[k]) + PAD_LIFT, pos.getZ(k) * d.radius);
        }
        g.computeBoundingSphere();
        return g;
      };
      const discKeys = keysOf(disc), ringKeys = keysOf(ring);
      this.pads.push({ disc: drape(disc, discKeys), ring: drape(ring, ringKeys) });
    }
    if (this.pads.length === 0) return;
    for (const [which, material] of [['disc', this.material], ['ring', this.activeMaterial]] as const) {
      const geos = this.pads.map((p, i) => {
        const g = p[which].clone();
        const pos = this.destinations[i].pos;
        return g.translate(pos.x, pos.y, pos.z);
      });
      const merged = mergeGeometries(geos, false);
      const mesh = new THREE.Mesh(merged, material);
      mesh.renderOrder = 2;
      this.root.add(mesh);
      this.all.push({ mesh, full: merged.index!.array.slice(), count: this.pads[0][which].index!.count });
    }
    this.active.add(new THREE.Mesh(this.pads[0].disc, this.material), new THREE.Mesh(this.pads[0].ring, this.activeMaterial));
    this.active.renderOrder = 2;
    this.active.visible = false;
    this.root.add(this.active);
  }

  /** Shows pad [i] as the pulsing current one, and every other pad in the merged meshes. */
  private showActive(i: number) {
    if (i === this.hidden) return;
    for (const { mesh, full, count } of this.all) {
      const index = mesh.geometry.index!;
      const arr = index.array as Uint16Array | Uint32Array;
      if (this.hidden >= 0) {
        for (let k = this.hidden * count; k < (this.hidden + 1) * count; k++) arr[k] = full[k];
      }
      // Degenerate triangles: the pad is drawn by the active group instead.
      if (i >= 0) arr.fill(0, i * count, (i + 1) * count);
      index.needsUpdate = true;
    }
    this.hidden = i;
    this.active.visible = i >= 0;
    if (i < 0) return;
    const [disc, ring] = this.active.children as THREE.Mesh[];
    disc.geometry = this.pads[i].disc;
    ring.geometry = this.pads[i].ring;
    this.active.position.copy(this.destinations[i].pos);
  }

  next() {
    if (this.destinations.length === 0) return;
    if (this.delivered >= TOTAL_JOBS) {
      this.current = null;
      return;
    }
    let d: Destination;
    do d = this.destinations[Math.floor(Math.random() * this.destinations.length)];
    while (d === this.current && this.destinations.length > 1);
    this.current = d;
    this.age = 0;
  }

  /** The street half of the job, once STREET_DELAY seconds have passed; else the seconds left. */
  streetIn(): number {
    return Math.max(0, STREET_DELAY - this.age);
  }

  /** Advances the job clock, pulses the current pad and delivers when [pos] is on it at a walking-ish speed. */
  update(dt: number, pos: THREE.Vector3, speed: number) {
    this.justDelivered = null;
    this.time += dt;
    this.age += dt;
    const cur = this.current;
    this.showActive(cur ? this.destinations.indexOf(cur) : -1);
    const s = 1 + 0.08 * Math.sin(this.time * 4);
    this.active.scale.set(s, 1, s); // the radius and the ground's heights are in the geometry
    if (!cur) return;
    const dx = pos.x - cur.pos.x, dz = pos.z - cur.pos.z;
    const near = Math.hypot(dx, dz) < ARRIVE_RADIUS && Math.abs(pos.y - cur.pos.y) < 3;
    if (near && Math.abs(speed) < ARRIVE_SPEED) {
      this.delivered++;
      this.justDelivered = cur;
      this.next();
    }
  }
}

export async function loadDeliveries(
  url: string,
  walls: Walls,
  ground: Ground,
  terrain: Terrain,
  bounds: Bounds,
): Promise<Deliveries> {
  const data = (await fetch(url).then((r) => r.json())) as { items: Entry[] };
  return new Deliveries(data.items, walls, ground, terrain, bounds);
}
