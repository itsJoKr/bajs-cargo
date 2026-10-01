// Gates that stand open (data/gates.json -> city.json `gates`) and the garden walls beside them
// (`stoneWalls`): two cream plaster posts with a cap each (and a lantern when `lanterns`), two
// wrought-iron leaves (rails, pickets with spear tips, higher towards the free edge when `arch`) swung
// back along the way through, so the bike and the car pass between them, and optionally a narrow
// side gate for people. Posts, leaves and walls are static colliders.

import * as THREE from 'three';
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface GateData {
  name?: string;
  /** Between the posts, at the ground, web frame. */
  x: number;
  y: number;
  z: number;
  /** Direction of travel, degrees clockwise from north. */
  heading: number;
  width: number;
  height: number;
  /** Lanterns on the posts either side of the main opening. */
  lanterns?: boolean;
  /** Extra height of the leaves' free edge over the hinge, as a fraction of the leaf height. */
  arch?: number;
  /** A narrow gate for people beside the main opening ([side] 1 = the right-hand side seen along the way through). */
  sideGate?: { width: number; side: number };
}

export interface StoneWallData {
  name?: string;
  kind: 'rubble' | 'plaster';
  height: number;
  thick: number;
  /** Ground posts [x, ground y, z], web frame, at most ~2 m apart. */
  posts: [number, number, number][];
}

const POST = 0.5; // post section, m
const LEAF_T = 0.04; // leaf thickness, m

/** Rubble stone in courses, 2 x 1 m a tile: ochre, brown and grey stones in lime mortar. */
function rubbleTexture(): THREE.Texture {
  const W = 512, H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d')!;
  x.fillStyle = '#6f6859';
  x.fillRect(0, 0, W, H);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  // Muted ochre, brown and grey limestone, as on the Kaptol walls.
  const palette = ['#9a8566', '#8a7658', '#7d6c52', '#8c8574', '#a09478', '#756f62', '#907b5c', '#a89c82'];
  const rows = [38, 66, 46, 58, 48];
  let y = 0;
  for (const rh of rows) {
    let px = -rnd() * 80;
    while (px < W) {
      const sw = 36 + rnd() * 120;
      const jy = (rnd() - 0.5) * 10;
      const sh = rh - 3 - rnd() * 8;
      const col = palette[Math.floor(rnd() * palette.length)];
      for (const dx of [0, -W, W]) {
        // Drawn again one tile left and right, so the rows wrap seamlessly.
        x.fillStyle = col;
        x.beginPath();
        x.roundRect(px + dx + 3, y + 3 + jy, sw - 6, sh, 14 + rnd() * 6);
        x.fill();
        x.fillStyle = 'rgba(255,245,220,0.07)';
        x.fillRect(px + dx + 9, y + 6 + jy, sw - 20, 3);
        x.fillStyle = 'rgba(0,0,0,0.16)';
        x.fillRect(px + dx + 9, y + sh - 2 + jy, sw - 20, 3);
      }
      px += sw;
    }
    y += rh;
  }
  // Lime patches and speckle, so the stones are not flat.
  for (let i = 0; i < 70; i++) {
    x.fillStyle = `rgba(222,214,196,${0.10 + rnd() * 0.12})`;
    x.beginPath();
    x.ellipse(rnd() * W, rnd() * H, 6 + rnd() * 18, 3 + rnd() * 8, 0, 0, Math.PI * 2);
    x.fill();
  }
  for (let i = 0; i < 3200; i++) {
    x.fillStyle = `rgba(${rnd() < 0.55 ? '0,0,0' : '255,255,255'},${0.05 + rnd() * 0.09})`;
    x.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 3, 1 + rnd() * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Whitewashed plaster, 2 x 1 m a tile: off-white with faint stains. */
function plasterTexture(): THREE.Texture {
  const W = 256, H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d')!;
  x.fillStyle = '#e6e1d4';
  x.fillRect(0, 0, W, H);
  let seed = 11;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 900; i++) {
    x.fillStyle = `rgba(${rnd() < 0.6 ? '90,80,60' : '255,255,250'},${0.03 + rnd() * 0.07})`;
    const w = 2 + rnd() * 12, h = 1 + rnd() * 5, px = rnd() * W, py = rnd() * H;
    x.fillRect(px, py, w, h);
    if (px + w > W) x.fillRect(px - W, py, w, h);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** A wall along [posts] as one continuous ribbon: mitred at every bend, so no gap opens at a joint; both
 * faces, the top and the two end caps, UVs in 2 x 1 m tiles. */
function wallGeometry(w: StoneWallData): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const quad = (p: THREE.Vector3[], u: number[], v: number[]) => {
    const o = pos.length / 3;
    for (let i = 0; i < 4; i++) {
      pos.push(p[i].x, p[i].y, p[i].z);
      uv.push(u[i], v[i]);
    }
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  };
  const pts = w.posts.filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1][0], p[2] - a[i - 1][2]) > 0.01);
  const n = pts.length;
  if (n < 2) return new THREE.BufferGeometry();
  const h = w.thick / 2;
  const lo = 0.8; // buried, so a slope between posts never shows a gap under the wall
  // Left-hand normals of each segment, then the mitre offset at each post.
  const nrm: [number, number][] = [];
  for (let i = 0; i + 1 < n; i++) {
    const dx = pts[i + 1][0] - pts[i][0], dz = pts[i + 1][2] - pts[i][2];
    const l = Math.hypot(dx, dz);
    nrm.push([-dz / l, dx / l]);
  }
  const off: [number, number][] = pts.map((_, i) => {
    if (i === 0) return [nrm[0][0] * h, nrm[0][1] * h];
    if (i === n - 1) return [nrm[n - 2][0] * h, nrm[n - 2][1] * h];
    const [ax, az] = nrm[i - 1], [bx, bz] = nrm[i];
    let mx = ax + bx, mz = az + bz;
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml;
    mz /= ml;
    const k = Math.min(3, 1 / Math.max(0.33, mx * ax + mz * az)); // length of the mitre, capped on sharp bends
    return [mx * h * k, mz * h * k];
  });
  const L = pts.map((p, i) => [p[0] + off[i][0], p[2] + off[i][1]] as [number, number]);
  const R = pts.map((p, i) => [p[0] - off[i][0], p[2] - off[i][1]] as [number, number]);
  const v3 = (xz: [number, number], y: number) => new THREE.Vector3(xz[0], y, xz[1]);
  let run = 0;
  for (let i = 0; i + 1 < n; i++) {
    const len = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][2] - pts[i][2]);
    const y0 = pts[i][1], y1 = pts[i + 1][1];
    const u0 = run / 2, u1 = (run + len) / 2;
    // Left face (faces left of the way), right face, top: each wound counter-clockwise seen from outside.
    quad([v3(L[i], y0 - lo), v3(L[i + 1], y1 - lo), v3(L[i + 1], y1 + w.height), v3(L[i], y0 + w.height)], [u0, u1, u1, u0], [-lo, -lo, w.height, w.height]);
    quad([v3(R[i + 1], y1 - lo), v3(R[i], y0 - lo), v3(R[i], y0 + w.height), v3(R[i + 1], y1 + w.height)], [u1, u0, u0, u1], [-lo, -lo, w.height, w.height]);
    quad([v3(L[i], y0 + w.height), v3(L[i + 1], y1 + w.height), v3(R[i + 1], y1 + w.height), v3(R[i], y0 + w.height)], [u0, u1, u1, u0], [0, 0, 0.5, 0.5]);
    run += len;
  }
  // End caps.
  for (const [i, flip] of [[0, true], [n - 1, false]] as [number, boolean][]) {
    const y = pts[i][1];
    const c = [v3(L[i], y - lo), v3(R[i], y - lo), v3(R[i], y + w.height), v3(L[i], y + w.height)];
    quad(flip ? [c[1], c[0], c[3], c[2]] : c, [0, 0.5, 0.5, 0], [-lo, -lo, w.height, w.height]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function buildGates(gates: GateData[], walls: StoneWallData[], R: typeof RAPIER_NS, world: RAPIER_NS.World): THREE.Group {
  const root = new THREE.Group();
  root.name = 'gates';
  const stone: THREE.BufferGeometry[] = [];
  const iron: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  const box = (list: THREE.BufferGeometry[], w: number, h: number, d: number, at: THREE.Vector3, yaw: number, pitch = 0) => {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    if (pitch) g.rotateZ(pitch);
    g.rotateY(yaw);
    g.translate(at.x, at.y, at.z);
    g.deleteAttribute('uv');
    list.push(g);
  };
  const collider = (w: number, h: number, d: number, at: THREE.Vector3, yaw: number) =>
    world.createCollider(
      R.ColliderDesc.cuboid(w / 2, h / 2, d / 2)
        .setTranslation(at.x, at.y, at.z)
        .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }),
    );
  for (const gate of gates) {
    const h = THREE.MathUtils.degToRad(gate.heading);
    // Web frame (z south): a heading of 0 is -z, 90 is +x.
    const fwd = new THREE.Vector3(Math.sin(h), 0, -Math.cos(h));
    const right = new THREE.Vector3(Math.cos(h), 0, Math.sin(h));
    // three.js rotateY turns +x towards -z; the gate's own +x is `right`, so yaw = atan2(-right.z, right.x).
    const yaw = Math.atan2(-right.z, right.x);
    const base = new THREE.Vector3(gate.x, gate.y, gate.z);
    const post = (at: THREE.Vector3, tall: number, lantern: boolean) => {
      box(stone, POST, tall, POST, at.clone().setY(gate.y + tall / 2 - 0.1), yaw);
      box(stone, POST + 0.14, 0.1, POST + 0.14, at.clone().setY(gate.y + tall - 0.05), yaw);
      box(stone, POST - 0.1, 0.22, POST - 0.1, at.clone().setY(gate.y + tall + 0.11), yaw);
      collider(POST, tall + 0.3, POST, at.clone().setY(gate.y + (tall + 0.3) / 2 - 0.1), yaw);
      if (lantern) {
        // A black cage with a lit pane, on a bracket on the inner face.
        const l = at.clone().addScaledVector(fwd, POST / 2 + 0.12).setY(gate.y + tall - 0.35);
        box(iron, 0.05, 0.05, 0.22, at.clone().addScaledVector(fwd, POST / 2 + 0.05).setY(gate.y + tall - 0.12), yaw);
        box(iron, 0.22, 0.04, 0.22, l.clone().setY(l.y + 0.14), yaw);
        box(iron, 0.22, 0.04, 0.22, l.clone().setY(l.y - 0.14), yaw);
        box(glass, 0.15, 0.24, 0.15, l, yaw);
      }
    };
    const ph = gate.height + 0.25;
    for (const side of [-1, 1]) {
      post(base.clone().addScaledVector(right, side * (gate.width / 2 + POST / 2)), ph, !!gate.lanterns);
      // The leaf, folded back along the way through (towards +fwd) beside the post.
      const len = gate.width / 2 - 0.12;
      const hinge = base.clone().addScaledVector(right, side * (gate.width / 2 - 0.06));
      const centre = hinge.clone().addScaledVector(fwd, len / 2);
      const leafYaw = yaw + Math.PI / 2; // the leaf's long axis runs along fwd
      const lh = gate.height - 0.3;
      const y0 = gate.y + 0.18;
      const arch = gate.arch ?? 0;
      const slope = Math.atan((arch * lh) / len);
      const topAt = (t: number) => lh * (1 + (arch * t) / len);
      box(iron, len, 0.07, LEAF_T * 1.5, centre.clone().setY(y0 + 0.06), leafYaw);
      box(iron, len / Math.cos(slope), 0.07, LEAF_T * 1.5, centre.clone().setY(y0 + topAt(len / 2) - 0.04), leafYaw, slope);
      box(iron, len / Math.cos(slope), 0.05, LEAF_T * 1.5, centre.clone().setY(y0 + topAt(len / 2) * 0.55), leafYaw, slope * 0.55);
      const n = Math.floor(len / 0.13);
      for (let i = 0; i <= n; i++) {
        const t = (i / n) * (len - 0.05) + 0.025;
        const at = hinge.clone().addScaledVector(fwd, t);
        const ph2 = topAt(t);
        box(iron, 0.022, ph2, 0.022, at.clone().setY(y0 + ph2 / 2), leafYaw);
        const tip = new THREE.ConeGeometry(0.03, 0.12, 4).toNonIndexed();
        tip.translate(at.x, y0 + ph2 + 0.06, at.z);
        tip.deleteAttribute('uv');
        iron.push(tip);
      }
      collider(len, lh * (1 + arch / 2), LEAF_T * 2, centre.clone().setY(y0 + (lh * (1 + arch / 2)) / 2), leafYaw);
    }
    // The people's gate beside the main opening, also open: a post, the gap, a post, and the leaf swung back.
    if (gate.sideGate) {
      const s = gate.sideGate.side >= 0 ? 1 : -1;
      const w = gate.sideGate.width;
      const inner = gate.width / 2 + POST; // the main gate's outer post face
      const p2 = base.clone().addScaledVector(right, s * (inner + w + POST / 2));
      post(p2, ph - 0.25, false);
      const hinge = base.clone().addScaledVector(right, s * (inner + w - 0.04));
      const len = w - 0.1;
      const centre = hinge.clone().addScaledVector(fwd, len / 2);
      const leafYaw = yaw + Math.PI / 2;
      const lh = gate.height - 0.5;
      const y0 = gate.y + 0.15;
      box(iron, len, 0.06, LEAF_T * 1.5, centre.clone().setY(y0 + 0.05), leafYaw);
      box(iron, len, 0.06, LEAF_T * 1.5, centre.clone().setY(y0 + lh - 0.04), leafYaw);
      const n = Math.floor(len / 0.12);
      for (let i = 0; i <= n; i++) {
        const at = hinge.clone().addScaledVector(fwd, (i / n) * (len - 0.04) + 0.02);
        box(iron, 0.02, lh, 0.02, at.clone().setY(y0 + lh / 2), leafYaw);
      }
      collider(len, lh, LEAF_T * 2, centre.clone().setY(y0 + lh / 2), leafYaw);
    }
  }
  const add = (list: THREE.BufferGeometry[], m: THREE.Material) => {
    if (!list.length) return;
    const mesh = new THREE.Mesh(mergeGeometries(list, false), m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  };
  add(stone, new THREE.MeshStandardMaterial({ color: 0xd6cfba, roughness: 0.9 }));
  add(iron, new THREE.MeshStandardMaterial({ color: 0x1c2620, roughness: 0.55, metalness: 0.35 }));
  add(glass, new THREE.MeshStandardMaterial({ color: 0xfff1c0, emissive: 0xffd98a, emissiveIntensity: 0.6, roughness: 0.4 }));

  // The garden walls: one mesh and one box collider per piece of each polyline.
  const mats = { rubble: new THREE.MeshStandardMaterial({ map: rubbleTexture(), roughness: 1 }), plaster: new THREE.MeshStandardMaterial({ map: plasterTexture(), roughness: 0.95 }) };
  const copings: THREE.BufferGeometry[] = [];
  for (const w of walls) {
    const mesh = new THREE.Mesh(wallGeometry(w), mats[w.kind]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    for (let i = 0; i + 1 < w.posts.length; i++) {
      const [ax, ay, az] = w.posts[i], [bx, by, bz] = w.posts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.01) continue;
      const yaw = Math.atan2(-(bz - az), bx - ax);
      const lowY = Math.min(ay, by) - 0.8, topY = Math.max(ay, by) + w.height;
      collider(len + w.thick, topY - lowY, w.thick, new THREE.Vector3((ax + bx) / 2, (lowY + topY) / 2, (az + bz) / 2), yaw);
      // A stone coping, a little proud of the wall, along the plaster walls.
      if (w.kind === 'plaster') {
        const g = new THREE.BoxGeometry(len + 0.02, 0.1, w.thick + 0.12).toNonIndexed();
        g.rotateZ(Math.atan2(by - ay, len));
        g.rotateY(yaw);
        g.translate((ax + bx) / 2, (ay + by) / 2 + w.height + 0.05, (az + bz) / 2);
        g.deleteAttribute('uv');
        copings.push(g);
      }
    }
  }
  add(copings, new THREE.MeshStandardMaterial({ color: 0xc9c2ae, roughness: 0.9 }));
  return root;
}
