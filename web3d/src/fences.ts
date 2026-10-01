// Fences that close off what the player may not enter (data/fences.json -> city.json `fences`):
// mobile construction-site panels, a galvanised tube frame with welded mesh (or a white tarp) on
// concrete feet, one panel between each pair of posts. Every panel is a static collider, so the
// bike and the car stop at it and the crowd's probe keeps pedestrians on this side.

import * as THREE from 'three';
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface FenceData {
  style?: string;
  tarp?: boolean;
  height?: number;
  /** Metres of invisible wall on top of the fence's collider (default: the fence's own height). */
  wall?: number;
  /** Posts [x, ground y, z], web frame. */
  posts: [number, number, number][];
}

function meshTexture(): THREE.Texture {
  // Welded mesh: 10 x 25 cm cells, 32 x 64 px per 0.5 x 1 m tile.
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 64;
  const x = c.getContext('2d')!;
  x.strokeStyle = 'rgba(190,194,196,1)';
  x.lineWidth = 1.2;
  for (let i = 0; i <= 32; i += 6.4) {
    x.beginPath();
    x.moveTo(i, 0);
    x.lineTo(i, 64);
    x.stroke();
  }
  for (let j = 0; j <= 64; j += 16) {
    x.beginPath();
    x.moveTo(0, j);
    x.lineTo(32, j);
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function stripeTexture(): THREE.Texture {
  // Red and white diagonal stripes of a road barrier, 0.8 m a repeat (a 25 cm board).
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 32;
  const x = c.getContext('2d')!;
  x.fillStyle = '#eeeae0';
  x.fillRect(0, 0, 128, 32);
  x.fillStyle = '#c8281f';
  for (let i = -2; i < 6; i++) {
    x.beginPath();
    x.moveTo(i * 32, 32);
    x.lineTo(i * 32 + 16, 32);
    x.lineTo(i * 32 + 48, 0);
    x.lineTo(i * 32 + 32, 0);
    x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function buildFences(fences: FenceData[], R: typeof RAPIER_NS, world: RAPIER_NS.World): THREE.Group {
  const root = new THREE.Group();
  root.name = 'fences';
  const frames: THREE.BufferGeometry[] = [];
  const feet: THREE.BufferGeometry[] = [];
  const meshes: THREE.BufferGeometry[] = [];
  const tarps: THREE.BufferGeometry[] = [];
  const boards: THREE.BufferGeometry[] = [];
  const lamps: THREE.BufferGeometry[] = [];
  const cones: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const tube = (a: THREE.Vector3, b: THREE.Vector3, r = 0.02) => {
    const d = b.clone().sub(a);
    const g = new THREE.CylinderGeometry(r, r, d.length(), 6, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, d.normalize()));
    g.translate(...a.clone().add(b).multiplyScalar(0.5).toArray());
    return g.toNonIndexed();
  };
  for (const f of fences) {
    const h = f.height ?? 2;
    for (let i = 0; i + 1 < f.posts.length; i++) {
      const [ax, ay, az] = f.posts[i], [bx, by, bz] = f.posts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const yaw = Math.atan2(-(bz - az), bx - ax);
      const lift = 0.12; // on its feet
      const a0 = new THREE.Vector3(ax, ay + lift, az), b0 = new THREE.Vector3(bx, by + lift, bz);
      const a1 = a0.clone().setY(ay + lift + h), b1 = b0.clone().setY(by + lift + h);
      frames.push(tube(a0, a1, 0.021), tube(b0, b1, 0.021), tube(a0, b0), tube(a1, b1));
      // The infill, a quad inset a few cm in the frame, double-sided.
      const q = new THREE.BufferGeometry();
      const pts = [a0, b0, b1, a1].map((p) => p.clone().setY(p.y + (p === a0 || p === b0 ? 0.03 : -0.03)));
      q.setAttribute('position', new THREE.Float32BufferAttribute([...pts[0].toArray(), ...pts[1].toArray(), ...pts[2].toArray(), ...pts[0].toArray(), ...pts[2].toArray(), ...pts[3].toArray()], 3));
      const u = len / 0.5, v = h;
      q.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, u, 0, u, v, 0, 0, u, v, 0, v], 2));
      q.computeVertexNormals();
      (f.tarp ? tarps : meshes).push(q);
      // A concrete foot under every post.
      for (const [px, py, pz] of i === 0 ? [f.posts[i], f.posts[i + 1]] : [f.posts[i + 1]]) {
        const g = new THREE.BoxGeometry(0.7, lift + 0.02, 0.2).toNonIndexed();
        g.rotateY(yaw);
        g.translate(px, py + lift / 2, pz);
        feet.push(g);
        if (f.style === 'roadblock') {
          // A flashing amber lamp on the post, and a cone at its foot.
          const l = new THREE.CylinderGeometry(0.09, 0.09, 0.16, 8).toNonIndexed();
          l.translate(px, py + lift + h + 0.08, pz);
          lamps.push(l);
          const cone = new THREE.ConeGeometry(0.16, 0.7, 8).toNonIndexed();
          cone.translate(px + Math.sin(yaw) * 0.6, py + 0.35, pz + Math.cos(yaw) * 0.6);
          cones.push(cone);
        }
      }
      if (f.style === 'roadblock') {
        // Two striped barrier boards across the panel, at 1.05 and 0.6 m, on the near side.
        for (const y of [1.05, 0.6]) {
          const g = new THREE.BoxGeometry(len, 0.25, 0.04);
          const uv = g.getAttribute('uv');
          for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * (len / 0.8));
          g.rotateY(yaw);
          g.translate((ax + bx) / 2, (ay + by) / 2 + y, (az + bz) / 2);
          boards.push(g);
        }
      }
      const my = (ay + by) / 2 + lift + h / 2;
      const top = Math.max(h, f.wall ?? 0);
      world.createCollider(
        R.ColliderDesc.cuboid(len / 2 + 0.05, top / 2 + lift, 0.2)
          .setTranslation((ax + bx) / 2, (ay + by) / 2 + (top + lift) / 2, (az + bz) / 2)
          .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }),
      );
    }
  }
  const add = (list: THREE.BufferGeometry[], m: THREE.Material, shadow = true) => {
    if (!list.length) return;
    const mesh = new THREE.Mesh(mergeGeometries(list, false), m);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    root.add(mesh);
  };
  for (const g of [...frames, ...feet, ...lamps, ...cones]) g.deleteAttribute('uv');
  add(frames, new THREE.MeshStandardMaterial({ color: 0xb4b8ba, roughness: 0.45, metalness: 0.7 }));
  add(feet, new THREE.MeshStandardMaterial({ color: 0x8d8a84, roughness: 0.95 }));
  add(meshes, new THREE.MeshStandardMaterial({ map: meshTexture(), transparent: true, alphaTest: 0.05, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6, depthWrite: false }), false);
  add(boards, new THREE.MeshStandardMaterial({ map: stripeTexture(), roughness: 0.6 }));
  add(cones, new THREE.MeshStandardMaterial({ color: 0xe8541a, roughness: 0.7 }));
  add(lamps, new THREE.MeshBasicMaterial({ color: 0xffb020 }), false);
  add(tarps, new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.9, side: THREE.DoubleSide }));
  return root;
}
