// Hand-placed 3D features from data/buildings.json, resolved onto their
// walls by tool/export_web.dart: signs cut from the Street View photos,
// awnings, scaffolding, café terraces, domes, boxes and arbitrary models.
// The recreate-building skill (.claude/skills/recreate-building) documents
// every type and field.
//
// Every feature carries its wall: `a`, `b` (ends, web frame), `n` (outward
// normal), `ground` (sidewalk height at the wall) and `eave`. Positions
// along the wall are fractions (`at`, `from`..`to`, 0 = end a); heights are
// `y` metres above the sidewalk or `aboveEave` metres above the eave.

import * as THREE from 'three';
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { TerraceTable } from './furniture.ts';

export interface Feature {
  type: 'sign' | 'awning' | 'scaffolding' | 'terrace' | 'model' | 'dome' | 'box';
  building: string;
  wall: string;
  a: [number, number];
  b: [number, number];
  n: [number, number];
  ground: number;
  eave: number;
  at?: number;
  from?: number;
  to?: number;
  y?: number;
  aboveEave?: number;
  out?: number;
  width?: number;
  height?: number;
  depth?: number;
  drop?: number;
  radius?: number;
  color?: string;
  image?: string;
  /** File under `features/tex/`; tiles every `repeat` metres, `color` tints it. */
  texture?: string;
  repeat?: number;
  mount?: 'wall' | 'projecting' | 'roof';
  glow?: boolean;
  url?: string;
  yaw?: number;
  scale?: number;
  net?: string;
  shape?: 'dome' | 'onion' | 'cone';
}

class Wall {
  readonly a: THREE.Vector3;
  readonly b: THREE.Vector3;
  readonly t: THREE.Vector3;
  readonly n: THREE.Vector3;
  readonly length: number;
  constructor(f: Feature) {
    this.a = new THREE.Vector3(f.a[0], 0, f.a[1]);
    this.b = new THREE.Vector3(f.b[0], 0, f.b[1]);
    this.length = this.a.distanceTo(this.b);
    this.t = this.b.clone().sub(this.a).normalize();
    this.n = new THREE.Vector3(f.n[0], 0, f.n[1]).normalize();
  }
  /** A point [s] of the way along, [out] metres in front, at height [y]. */
  point(s: number, out: number, y: number) {
    return this.a.clone().lerp(this.b, s).addScaledVector(this.n, out).setY(y);
  }
  /** Rotation that turns a +z-facing object to face out of the wall. */
  facing() {
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.n);
  }
}

const heightOf = (f: Feature, fallback: number) =>
  f.aboveEave !== undefined ? f.eave + f.aboveEave : f.ground + (f.y ?? fallback);

/** Builds [features]; terraces are not built here but appended to [tables]
 * for furniture.ts. */
export async function buildFeatures(
  features: Feature[],
  R: typeof RAPIER_NS,
  world: RAPIER_NS.World,
  anisotropy: number,
  tables: TerraceTable[],
): Promise<THREE.Group> {
  const root = new THREE.Group();
  root.name = 'features';
  const textures = new THREE.TextureLoader();
  const gltf = new GLTFLoader();
  const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.7, metalness: 0, ...extra });
  const add = (mesh: THREE.Object3D) => {
    mesh.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = m.receiveShadow = true;
    });
    root.add(mesh);
    return mesh;
  };
  /** Tiling textures, loaded once per file; tiling is baked into the UVs
   * (metres per tile), so one texture serves meshes of any size. */
  const tiled = new Map<string, THREE.Texture>();
  const tileTexture = async (file: string) => {
    let t = tiled.get(file);
    if (!t) {
      t = await textures.loadAsync(`features/tex/${file}`);
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = anisotropy;
      tiled.set(file, t);
    }
    return t;
  };
  /** Material for [f]: its `texture` (tinted by `color`) or the flat [fallback]. */
  const featureMat = async (f: Feature, fallback: string, extra: THREE.MeshStandardMaterialParameters = {}) => {
    const map = f.texture ? await tileTexture(f.texture) : null;
    return mat(f.color ?? (map ? '#ffffff' : fallback), { ...(map ? { map } : {}), ...extra });
  };
  /** Rescales the UVs of vertices [from, to) so u spans [u] metres and v [v]. */
  const tileUV = (g: THREE.BufferGeometry, f: Feature, u: number, v: number, from = 0, to = g.attributes.uv.count) => {
    if (!f.texture) return;
    const rep = f.repeat ?? 1;
    const uv = g.attributes.uv;
    for (let i = from; i < to; i++) uv.setXY(i, (uv.getX(i) * u) / rep, (uv.getY(i) * v) / rep);
    uv.needsUpdate = true;
  };
  /** A static box collider matching a mesh-space box. */
  const collide = (center: THREE.Vector3, half: THREE.Vector3, q: THREE.Quaternion) => {
    world.createCollider(R.ColliderDesc.cuboid(half.x, half.y, half.z).setTranslation(center.x, center.y, center.z).setRotation(q));
  };

  for (const f of features) {
    const w = new Wall(f);
    const q = w.facing();
    try {
      switch (f.type) {
        case 'sign': {
          const tex = await textures.loadAsync(`features/${f.image}`);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = anisotropy;
          const width = f.width ?? 3;
          const height = f.height ?? (width * tex.image.height) / tex.image.width;
          const material = new THREE.MeshStandardMaterial({
            map: tex,
            transparent: true,
            alphaTest: 0.35,
            side: THREE.DoubleSide,
            roughness: 0.6,
            emissive: f.glow ? new THREE.Color(0xffffff) : new THREE.Color(0x000000),
            emissiveMap: f.glow ? tex : null,
            emissiveIntensity: f.glow ? 0.6 : 0,
          });
          const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
          const mount = f.mount ?? 'wall';
          const s = f.at ?? 0.5;
          if (mount === 'projecting') {
            // Perpendicular to the wall, both faces readable.
            const y = heightOf(f, 3.5) + height / 2;
            plane.position.copy(w.point(s, (f.out ?? 0.25) + width / 2, y));
            plane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), w.t);
            const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, width + 0.3), mat('#2a2d30', { metalness: 0.6 }));
            arm.position.copy(w.point(s, (width + 0.3) / 2, y + height / 2 + 0.05));
            arm.quaternion.copy(q);
            add(arm);
          } else if (mount === 'roof') {
            // Standing on the roof behind the cornice, on a frame of posts.
            const y = f.aboveEave !== undefined ? f.eave + f.aboveEave : f.eave + 0.4;
            const inset = f.out ?? -1.2;
            plane.position.copy(w.point(s, inset, y + height / 2));
            plane.quaternion.copy(q);
            for (const e of [-0.45, 0, 0.45]) {
              const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, height + 0.4, 0.08), mat('#3a3d40', { metalness: 0.5 }));
              post.position.copy(w.point(s, inset - 0.12, y + (height + 0.4) / 2 - 0.4)).addScaledVector(w.t, e * width);
              add(post);
            }
          } else {
            plane.position.copy(w.point(s, f.out ?? 0.06, heightOf(f, 3.5) + height / 2));
            plane.quaternion.copy(q);
          }
          add(plane);
          break;
        }
        case 'awning': {
          const s0 = f.from ?? 0, s1 = f.to ?? 1;
          const span = (s1 - s0) * w.length;
          const depth = f.depth ?? 1.4;
          const y = heightOf(f, 2.6);
          const drop = f.drop ?? 0.7;
          const color = await featureMat(f, '#2f5a45', { side: THREE.DoubleSide, roughness: 0.85 });
          const mid = (s0 + s1) / 2;
          // Sloped canvas from the wall down to the front bar, and a valance.
          const canvasGeo = new THREE.PlaneGeometry(span, Math.hypot(depth, drop));
          tileUV(canvasGeo, f, span, Math.hypot(depth, drop));
          const canvas = new THREE.Mesh(canvasGeo, color);
          canvas.position.copy(w.point(mid, depth / 2, y + drop / 2));
          canvas.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2 + Math.atan2(drop, depth)));
          add(canvas);
          const valanceGeo = new THREE.PlaneGeometry(span, 0.28);
          tileUV(valanceGeo, f, span, 0.28);
          const valance = new THREE.Mesh(valanceGeo, color);
          valance.position.copy(w.point(mid, depth, y - 0.14));
          valance.quaternion.copy(q);
          add(valance);
          break;
        }
        case 'scaffolding': {
          const s0 = f.from ?? 0, s1 = f.to ?? 1;
          const top = f.aboveEave !== undefined ? f.eave + f.aboveEave : f.height !== undefined ? f.ground + f.height : f.eave + 1;
          const depth = f.depth ?? 1.1;
          const steel = mat('#8c9096', { metalness: 0.7, roughness: 0.4 });
          const plank = mat('#9b7a4e');
          const bays = Math.max(1, Math.round(((s1 - s0) * w.length) / 2.5));
          const levels = Math.max(1, Math.round((top - f.ground) / 2));
          const tube = (from: THREE.Vector3, to: THREE.Vector3) => {
            const len = from.distanceTo(to);
            const m = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 6), steel);
            m.position.copy(from).add(to).multiplyScalar(0.5);
            m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
            add(m);
          };
          for (let i = 0; i <= bays; i++) {
            const s = s0 + ((s1 - s0) * i) / bays;
            for (const out of [0.25, 0.25 + depth]) {
              tube(w.point(s, out, f.ground), w.point(s, out, top));
              const base = w.point(s, out, f.ground + 1);
              collide(base, new THREE.Vector3(0.05, 1, 0.05), q);
            }
          }
          for (let l = 1; l <= levels; l++) {
            const y = f.ground + ((top - f.ground) * l) / levels;
            for (const out of [0.25, 0.25 + depth]) tube(w.point(s0, out, y), w.point(s1, out, y));
            const deck = new THREE.Mesh(new THREE.BoxGeometry((s1 - s0) * w.length, 0.05, depth), plank);
            deck.position.copy(w.point((s0 + s1) / 2, 0.25 + depth / 2, y - 0.03));
            deck.quaternion.copy(q);
            add(deck);
          }
          if (f.net) {
            const netGeo = new THREE.PlaneGeometry((s1 - s0) * w.length, top - f.ground);
            tileUV(netGeo, f, (s1 - s0) * w.length, top - f.ground);
            const netMap = f.texture ? await tileTexture(f.texture) : null;
            const net = new THREE.Mesh(
              netGeo,
              mat(f.net, { ...(netMap ? { map: netMap, alphaTest: 0.3 } : {}), transparent: true, opacity: netMap ? 1 : 0.55, side: THREE.DoubleSide, depthWrite: false }),
            );
            net.position.copy(w.point((s0 + s1) / 2, 0.3 + depth, (top + f.ground) / 2));
            net.quaternion.copy(q);
            net.castShadow = false;
            root.add(net);
          }
          break;
        }
        case 'terrace': {
          // Loose furniture (furniture.ts): tables with their chairs along
          // the wall, a parasol over each.
          const s0 = f.from ?? 0, s1 = f.to ?? 1;
          const depth = f.depth ?? 3;
          const n = Math.max(1, Math.floor(((s1 - s0) * w.length) / 2.6));
          const rows = Math.max(1, Math.floor(depth / 2.4));
          const yaw = Math.atan2(w.t.x, w.t.z);
          for (let i = 0; i < n; i++) {
            for (let r = 0; r < rows; r++) {
              const p = w.point(s0 + ((s1 - s0) * (i + 0.5)) / n, 1.2 + r * 2.4, f.ground);
              tables.push([p.x, p.z, f.ground, yaw, f.color ?? '#f1ece0']);
            }
          }
          break;
        }
        case 'model': {
          const g = await gltf.loadAsync(f.url!);
          const model = g.scene;
          const s = f.scale ?? 1;
          model.scale.setScalar(s);
          model.position.copy(w.point(f.at ?? 0.5, f.out ?? 1, heightOf(f, 0)));
          model.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(f.yaw ?? 0)));
          add(model);
          model.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(model);
          const c = box.getCenter(new THREE.Vector3()), h = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
          if (h.x > 0.05 && h.z > 0.05) collide(c, h, new THREE.Quaternion());
          break;
        }
        case 'dome': {
          // A corner dome or tower cap: a drum, a cap and a small lantern.
          const r = f.radius ?? 2.5;
          const base = f.aboveEave !== undefined ? f.eave + f.aboveEave : f.eave;
          const p = w.point(f.at ?? 1, f.out ?? -r * 0.9, base);
          const drumH = f.height ?? r * 0.9;
          const stone = mat('#d8d0c0');
          const cap = await featureMat(f, '#6d9c86', { metalness: 0.3, roughness: 0.5 });
          const drum = new THREE.Mesh(new THREE.CylinderGeometry(r, r, drumH, 20), stone);
          drum.position.copy(p).setY(base + drumH / 2);
          add(drum);
          const shape = f.shape ?? 'dome';
          const capGeo =
            shape === 'cone'
              ? new THREE.ConeGeometry(r * 1.05, r * 2.2, 20)
              : new THREE.SphereGeometry(r * 1.02, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
          // u runs round the cap, v up its slope.
          tileUV(capGeo, f, 2 * Math.PI * r, shape === 'cone' ? r * 2.4 : r * 1.6);
          const capMesh = new THREE.Mesh(capGeo, cap);
          if (shape === 'onion') capMesh.scale.set(1.05, 1.5, 1.05);
          capMesh.position.copy(p).setY(base + drumH + (shape === 'cone' ? r * 1.1 : 0));
          add(capMesh);
          const lantern = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.12, r * 0.18, r * 0.8, 10), cap);
          lantern.position.copy(p).setY(base + drumH + (shape === 'cone' ? r * 2.2 : r * (shape === 'onion' ? 1.5 : 1)) + r * 0.3);
          add(lantern);
          break;
        }
        case 'box': {
          const width = f.width ?? 1, depth = f.depth ?? 1, height = f.height ?? 1;
          const boxGeo = new THREE.BoxGeometry(width, height, depth);
          // Faces in order +x -x +y -y +z -z, four vertices each.
          const faceSize = [[depth, height], [depth, height], [width, depth], [width, depth], [width, height], [width, height]];
          faceSize.forEach(([u, v], i) => tileUV(boxGeo, f, u, v, i * 4, i * 4 + 4));
          const m = new THREE.Mesh(boxGeo, await featureMat(f, '#888888'));
          const y = heightOf(f, 0);
          m.position.copy(w.point(f.at ?? 0.5, f.out ?? depth / 2, y + height / 2));
          m.quaternion.copy(q);
          add(m);
          if (y - f.ground < 1.5) collide(m.position, new THREE.Vector3(width / 2, height / 2, depth / 2), q);
          break;
        }
      }
    } catch (e) {
      console.warn(`[zg] feature ${f.type} on ${f.wall} failed:`, e);
    }
  }
  return root;
}
