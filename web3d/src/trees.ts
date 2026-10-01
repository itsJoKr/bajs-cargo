// Street trees: three species built once at load (London plane, horse
// chestnut, linden) and instanced at every tree city.json lists. A tapered
// trunk runs up into the crown and limbs end inside the foliage, so no part
// floats; the crown is ~150 leaf cards textured from the gen-image leaf
// sprays (public/models/tree_leaves.png, tool/prepare_trees.py) with
// normals pointing out of the crown, so it shades as one soft volume.

import * as THREE from 'three';
import type RAPIER_NS from '@dimforge/rapier3d-compat';

/** [x, z, base y, scale, yaw] as tool/src/props.dart treeInstance writes. */
export type TreeInstance = [number, number, number, number, number];

interface Species {
  bark: string;
  barkTint: number;
  /** Leaf atlas cell: 0 = plane leaves, 1 = linden leaves. */
  leafCell: number;
  leafTint: number;
  /** Clear trunk height and its radius above the root flare. */
  trunk: number;
  trunkRadius: number;
  /** Crown ellipsoid: centre height, horizontal and vertical radius. */
  crownY: number;
  rx: number;
  ry: number;
  limbs: number;
  cards: number;
  cardSize: number;
  seed: number;
}

const SPECIES: Species[] = [
  // London plane (Zrinjevac, Strossmayerov trg): tall clear trunk, broad crown.
  { bark: 'models/tree_bark_plane.jpg', barkTint: 0x9c9c94, leafCell: 0, leafTint: 0xffffff, trunk: 3.2, trunkRadius: 0.3,
    crownY: 8.4, rx: 4.6, ry: 3.6, limbs: 4, cards: 160, cardSize: 2.9, seed: 11 },
  // Horse chestnut: short trunk, dense dome, darker leaves.
  { bark: 'models/tree_bark_dark.jpg', barkTint: 0xc8c8c8, leafCell: 0, leafTint: 0xb4c4a0, trunk: 2.3, trunkRadius: 0.28,
    crownY: 6.8, rx: 4.0, ry: 3.5, limbs: 5, cards: 150, cardSize: 2.7, seed: 23 },
  // Linden: taller than wide, fresh yellow-green.
  { bark: 'models/tree_bark_dark.jpg', barkTint: 0xc8c8c8, leafCell: 1, leafTint: 0xffffff, trunk: 2.7, trunkRadius: 0.24,
    crownY: 7.5, rx: 2.9, ry: 4.3, limbs: 4, cards: 140, cardSize: 2.4, seed: 37 },
];

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

const hash = (a: number, b: number) => {
  const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

class Builder {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  colors: number[] = [];
  /** Leaf cards: the card's own normal, for fading it out edge-on. */
  cardNormals: number[] = [];
  index: number[] = [];
  vertex(p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, c?: THREE.Color) {
    this.positions.push(p.x, p.y, p.z);
    this.normals.push(n.x, n.y, n.z);
    this.uvs.push(u, v);
    if (c) this.colors.push(c.r, c.g, c.b);
    return this.positions.length / 3 - 1;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    if (this.colors.length) g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    if (this.cardNormals.length) g.setAttribute('cardNormal', new THREE.Float32BufferAttribute(this.cardNormals, 3));
    g.setIndex(this.index);
    g.computeBoundingSphere();
    return g;
  }
}

/** A tapered tube along [points] with radii [radii]; v runs in metres. */
function tube(b: Builder, points: THREE.Vector3[], radii: number[], sides: number) {
  const up = new THREE.Vector3(0, 1, 0);
  let along = 0;
  const rings: number[] = [];
  for (let k = 0; k < points.length; k++) {
    const dir = points[Math.min(k + 1, points.length - 1)].clone().sub(points[Math.max(k - 1, 0)]).normalize();
    const side = Math.abs(dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : up.clone().cross(dir).normalize();
    const other = dir.clone().cross(side).normalize();
    if (k > 0) along += points[k].distanceTo(points[k - 1]);
    rings.push(b.positions.length / 3);
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const n = side.clone().multiplyScalar(Math.cos(a)).addScaledVector(other, Math.sin(a));
      b.vertex(points[k].clone().addScaledVector(n, radii[k]), n, (i / sides) * 2, along / 1.6);
    }
  }
  for (let k = 0; k < points.length - 1; k++) {
    for (let i = 0; i < sides; i++) {
      const a = rings[k] + i, c = rings[k + 1] + i;
      b.index.push(a, a + 1, c, a + 1, c + 1, c);
    }
  }
}

function buildSpecies(sp: Species) {
  const rand = rng(sp.seed);
  const wood = new Builder();
  const leaves = new Builder();
  const centre = new THREE.Vector3((rand() - 0.5) * 0.5, sp.crownY, (rand() - 0.5) * 0.5);
  const R = sp.trunkRadius;

  // Trunk: root flare, clear stem, then a leader tapering into the crown.
  const lean = new THREE.Vector3((rand() - 0.5) * 0.3, 0, (rand() - 0.5) * 0.3);
  const top = sp.crownY + sp.ry * 0.55;
  const stem = [0, 0.35, sp.trunk * 0.6, sp.trunk, sp.crownY, top].map((y) =>
    new THREE.Vector3(lean.x * (y / top) + (y > sp.trunk ? centre.x * ((y - sp.trunk) / (top - sp.trunk)) : 0), y,
      lean.z * (y / top) + (y > sp.trunk ? centre.z * ((y - sp.trunk) / (top - sp.trunk)) : 0)));
  tube(wood, stem, [R * 1.45, R * 1.08, R, R * 0.9, R * 0.5, 0.05], 8);

  // Limbs from the top of the clear trunk out to the crown's inner shell,
  // each with a side branch; their tips seed the leaf clusters.
  const tips: THREE.Vector3[] = [];
  const at = (y: number) => {
    const k = stem.findIndex((p) => p.y >= y);
    const p0 = stem[Math.max(k - 1, 0)], p1 = stem[k];
    return p0.clone().lerp(p1, (y - p0.y) / Math.max(p1.y - p0.y, 1e-3));
  };
  for (let i = 0; i < sp.limbs; i++) {
    const angle = (i / sp.limbs) * Math.PI * 2 + rand() * 0.9;
    const y0 = sp.trunk + rand() * (sp.crownY - sp.trunk) * 0.45;
    const start = at(y0);
    const out = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const end = centre.clone()
      .addScaledVector(out, sp.rx * (0.6 + rand() * 0.2))
      .add(new THREE.Vector3(0, sp.ry * (rand() * 0.5 - 0.05), 0));
    const mid = start.clone().lerp(end, 0.5).add(new THREE.Vector3(0, 0.5 + rand() * 0.6, 0));
    tube(wood, [start, mid, end], [R * 0.55, R * 0.33, 0.04], 6);
    tips.push(end);
    const side = out.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), (rand() - 0.5) * 1.6);
    const twig = mid.clone()
      .addScaledVector(side, sp.rx * 0.45)
      .add(new THREE.Vector3(0, sp.ry * (0.3 + rand() * 0.3), 0));
    tube(wood, [mid, mid.clone().lerp(twig, 0.5), twig], [R * 0.25, R * 0.16, 0.03], 5);
    tips.push(twig);
  }

  // Leaf cards: most on the crown's shell, some around the limb tips.
  const tint = new THREE.Color(sp.leafTint);
  const u0 = sp.leafCell * 0.5;
  const scale = new THREE.Vector3(sp.rx, sp.ry, sp.rx);
  for (let i = 0; i < sp.cards; i++) {
    let p: THREE.Vector3;
    const dir = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
    if (dir.lengthSq() < 1e-4) dir.set(0, 1, 0);
    dir.normalize();
    if (i < tips.length * 3) {
      p = tips[i % tips.length].clone().addScaledVector(dir, 0.4 + rand() * 0.8);
    } else {
      // Flatter underside: fewer, higher cards below the equator.
      const frac = 0.5 + 0.5 * Math.sqrt(rand());
      p = centre.clone().add(dir.clone().multiply(scale).multiplyScalar(dir.y < -0.5 ? frac * 0.8 : frac));
    }
    const rel = p.clone().sub(centre).divide(scale);
    const shellN = rel.clone().divide(scale).normalize();
    // Card facing: mostly outward, jittered; spun randomly about its normal.
    const n = shellN.clone().add(new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(1.4)).normalize();
    const t0 = Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const tu = t0.clone().cross(n).normalize();
    const tv = n.clone().cross(tu).normalize();
    const spin = rand() * Math.PI * 2;
    const eu = tu.clone().multiplyScalar(Math.cos(spin)).addScaledVector(tv, Math.sin(spin));
    const ev = n.clone().cross(eu);
    const size = sp.cardSize * (0.75 + rand() * 0.5);
    // Inner and lower leaves are darker: cheap ambient occlusion.
    const depth = Math.min(rel.length(), 1);
    const ao = 0.4 + 0.6 * THREE.MathUtils.clamp(depth * 0.65 + (rel.y * 0.5 + 0.5) * 0.45, 0, 1);
    const c = tint.clone().multiplyScalar(ao * (0.9 + rand() * 0.2));
    const flip = rand() < 0.5;
    const base = leaves.positions.length / 3;
    for (const [su, sv] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
      const q = p.clone().addScaledVector(eu, su * size).addScaledVector(ev, sv * size);
      // Normals from the crown's centre, blended toward the vertex, so the
      // crown lights as a volume and not as a pile of flat cards.
      const vn = q.clone().sub(centre).divide(scale).divide(scale).normalize().lerp(shellN, 0.5).normalize();
      const u = u0 + 0.004 + ((flip ? -su : su) + 0.5) * 0.492;
      // The leaf DataTexture is not flipped: v = 0 is the picture's top.
      leaves.vertex(q, vn, u, 0.5 - sv, c);
      leaves.cardNormals.push(n.x, n.y, n.z);
    }
    leaves.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { wood: wood.geometry(), leaves: leaves.geometry() };
}

/**
 * The leaf atlas with its own mip chain: each level's alpha is scaled so
 * the share of texels passing the alpha test stays that of the full-size
 * texture. Plain mipmaps average a spray's gaps away, and a distant card
 * turns into a solid blurred disc.
 */
async function leafTexture(anisotropy: number) {
  const loader = new THREE.ImageLoader();
  const [rgb, alpha] = await Promise.all([
    loader.loadAsync('models/tree_leaves.jpg'),
    loader.loadAsync('models/tree_leaves_alpha.png'),
  ]);
  const read = (image: HTMLImageElement) => {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(image, 0, 0);
    return ctx.getImageData(0, 0, image.width, image.height).data;
  };
  const c = read(rgb), a = read(alpha);
  let w = rgb.width, h = rgb.height;
  let level = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    level[i * 4] = c[i * 4];
    level[i * 4 + 1] = c[i * 4 + 1];
    level[i * 4 + 2] = c[i * 4 + 2];
    level[i * 4 + 3] = a[i * 4];
  }
  const cutoff = 127.5;
  let covered = 0;
  for (let i = 0; i < w * h; i++) if (level[i * 4 + 3] >= cutoff) covered++;
  const coverage = covered / (w * h);
  const mipmaps: { data: Uint8Array; width: number; height: number }[] = [
    { data: Uint8Array.from(level), width: w, height: h },
  ];
  while (w > 1 || h > 1) {
    const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1);
    const next = new Float32Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        for (let k = 0; k < 4; k++) {
          const at = (xx: number, yy: number) => level[(Math.min(yy, h - 1) * w + Math.min(xx, w - 1)) * 4 + k];
          next[(y * nw + x) * 4 + k] =
            (at(2 * x, 2 * y) + at(2 * x + 1, 2 * y) + at(2 * x, 2 * y + 1) + at(2 * x + 1, 2 * y + 1)) / 4;
        }
      }
    }
    // The alpha that as many texels exceed as the full texture covers.
    const histogram = new Uint32Array(256);
    for (let i = 0; i < nw * nh; i++) histogram[Math.min(255, Math.round(next[i * 4 + 3]))]++;
    let seen = 0, threshold = 255;
    while (threshold > 0 && seen + histogram[threshold] < coverage * nw * nh) seen += histogram[threshold--];
    const scale = cutoff / Math.max(threshold, 1);
    const data = new Uint8Array(nw * nh * 4);
    for (let i = 0; i < nw * nh * 4; i++) data[i] = Math.min(255, (i & 3) === 3 ? next[i] * scale : next[i]);
    mipmaps.push({ data, width: nw, height: nh });
    level = next;
    w = nw;
    h = nh;
  }
  const texture = new THREE.DataTexture(mipmaps[0].data, rgb.width, rgb.height, THREE.RGBAFormat);
  texture.mipmaps = mipmaps as unknown as THREE.DataTexture['mipmaps'];
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

export async function buildTrees(
  trees: TreeInstance[],
  R: typeof RAPIER_NS,
  world: RAPIER_NS.World,
  anisotropy: number,
): Promise<THREE.Group> {
  const root = new THREE.Group();
  root.name = 'trees';
  const loader = new THREE.TextureLoader();
  const load = async (url: string) => {
    const t = await loader.loadAsync(url);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = anisotropy;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };
  const leafMap = await leafTexture(anisotropy);
  const leafMaterial = new THREE.MeshStandardMaterial({
    map: leafMap,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    vertexColors: true,
    color: 0xd8d8d8,
    roughness: 1,
    metalness: 0,
  });
  // The crown's normals already point outward on both faces of a card:
  // skip three's back-face normal flip. A card seen edge-on samples a
  // blurred mip of the spray and draws a pale disc: fade it out instead.
  leafMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 cardNormal;\nvarying float vFacing;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec3 cardView = normalize(mat3(modelViewMatrix) * mat3(instanceMatrix) * cardNormal);
        vFacing = abs(dot(cardView, normalize(-mvPosition.xyz)));`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFacing;')
      .replace(
        '#include <normal_fragment_begin>',
        THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''),
      )
      .replace('#include <alphatest_fragment>', 'diffuseColor.a *= smoothstep(0.12, 0.4, vFacing);\n#include <alphatest_fragment>');
  };
  const barks = new Map<string, THREE.MeshStandardMaterial>();
  for (const sp of SPECIES) {
    if (!barks.has(sp.bark)) {
      barks.set(sp.bark, new THREE.MeshStandardMaterial({ map: await load(sp.bark), color: sp.barkTint, roughness: 1, metalness: 0 }));
    }
  }

  // Species by neighbourhood, so a row or a park is mostly one kind, with
  // an odd one out here and there.
  const kindOf = ([x, z]: TreeInstance) => {
    const region = hash(Math.floor(x / 45), Math.floor(z / 45));
    const odd = hash(z * 0.37, x * 0.53);
    return Math.floor((odd < 0.15 ? odd / 0.15 : region) * SPECIES.length) % SPECIES.length;
  };
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const tint = new THREE.Color();
  SPECIES.forEach((sp, k) => {
    const mine = trees.filter((t) => kindOf(t) === k);
    if (!mine.length) return;
    const { wood, leaves } = buildSpecies(sp);
    const trunks = new THREE.InstancedMesh(wood, barks.get(sp.bark)!, mine.length);
    const crowns = new THREE.InstancedMesh(leaves, leafMaterial, mine.length);
    mine.forEach(([x, z, y, s, yaw], i) => {
      q.setFromAxisAngle(up, yaw);
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s * (0.92 + 0.16 * hash(x, z)), s));
      trunks.setMatrixAt(i, m);
      crowns.setMatrixAt(i, m);
      // Each tree a little lighter, darker, yellower or bluer.
      const h = hash(x * 1.7, z * 2.3);
      tint.setHSL(0.25 + (h - 0.5) * 0.05, 0.12, 0.5).multiplyScalar(0.9 + 0.35 * hash(z, x * 3.1));
      tint.lerp(new THREE.Color(1, 1, 1), 0.72);
      crowns.setColorAt(i, tint);
      world.createCollider(
        R.ColliderDesc.cylinder((sp.trunk / 2) * s, sp.trunkRadius * s).setTranslation(x, y + (sp.trunk / 2) * s, z),
      );
    });
    for (const mesh of [trunks, crowns]) {
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      root.add(mesh);
    }
  });
  return root;
}
