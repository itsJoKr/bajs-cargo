// Loads the city tool/export_web.dart bakes: buildings, roofs, streets and
// rails as one glTF, the atlas material that paints them, the street trees
// (trees.ts), and the static colliders the car drives on and into.

import * as THREE from 'three';
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { WalkData } from './people.ts';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { gridGeometry, sinkGrid, type Dip, type Grid } from './terrain.ts';
import { buildFeatures, type Feature } from './features.ts';
import { buildTrees, type TreeInstance } from './trees.ts';
import type { MarketStall, TerraceTable } from './furniture.ts';
import { buildCathedral, type Landmark } from './cathedral.ts';
import { buildFences, type FenceData } from './fences.ts';
import { buildGates, type GateData, type StoneWallData } from './gates.ts';
import { buildPassages, type PassageData } from './passages.ts';

export interface CityData {
  extent: [number, number, number, number];
  trees: TreeInstance[];
  lamps: [number, number, number][];
  /** Café tables, each with two chairs and a parasol (furniture.ts). */
  terraces?: TerraceTable[];
  /** Market stalls (data/markets.json), some under a parasol (furniture.ts). */
  stalls?: MarketStall[];
  trams: [number, number][][];
  coverage?: { done: number; walls: number };
  /** Roofs index the roof set's atlas (tool/prepare_roofs.py). */
  roofSet?: boolean;
  /** Number of hero atlas pages (textures/hero_atlas_<n>.png). */
  heroPages?: number;
  /** Areas the car cannot enter: [minX, minZ, maxX, maxZ], web frame. */
  blocked?: number[][];
  features?: Feature[];
  /** Where a pedestrian can stand (people.ts). */
  walk?: WalkData;
  /** Hand-placed free-standing props (data/props.json; squareprops.ts). */
  props?: import('./squareprops.ts').PropItem[];
  /** Street walls: id -> [ax, az, bx, bz, nx, nz, sidewalk y, eave y]. */
  walls?: Record<string, number[]>;
  /** Fences round what the player may not enter (data/fences.json; fences.ts). */
  fences?: FenceData[];
  /** Gates that stand open (data/gates.json; gates.ts). */
  gates?: GateData[];
  /** Garden walls beside the gates (data/gates.json `walls`; gates.ts). */
  stoneWalls?: StoneWallData[];
  /** Hollows in the ground (levels.json "dip"): the bare terrain grid sinks with them. */
  dips?: Dip[];
  /** Buildings the game models by hand instead of the export (the Cathedral; cathedral.ts). */
  landmarks?: Landmark[];
  /** Covered passages through the blocks (data/passages.json; passages.ts). */
  passages?: PassageData[];
}

export interface City {
  root: THREE.Group;
  data: CityData;
  /** The ground grid (null when exported --flat). */
  ground: Grid | null;
  far: Grid | null;
  /** Café tables from OSM and from terrace features, for furniture.ts. */
  tables: TerraceTable[];
}

/**
 * Props (kiosks, canopies, the statue, the fountain, lamps): vertex colour,
 * with UV1 = (kind, roughness): 0 matte, 1 metal, 2 glass, 3 water, 4 lamp
 * glass that glows a little.
 */
function propMaterial() {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aInfo;
        varying vec2 vInfo;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vInfo = aInfo;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vInfo;`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = vInfo.y > 0.01 ? vInfo.y : 0.8;`)
      .replace('#include <metalnessmap_fragment>', `float kind = floor(vInfo.x + 0.5);
        float metalnessFactor = kind == 1.0 ? 0.75 : (kind == 2.0 || kind == 5.0 ? 0.35 : 0.0);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (kind == 4.0) totalEmissiveRadiance += diffuseColor.rgb * 0.6;`);
  };
  material.customProgramCacheKey = () => 'city-prop';
  return material;
}

/**
 * The city's one surface material, ported from
 * assets/materials/city_atlas.fmat: UV1 = (tile, roughness), UV0 counts
 * tile repeats and the shader wraps it inside the tile's padded atlas cell;
 * UV1.x = -1 - page (down to -50) samples that layer of the Street View hero
 * atlas (one block-compressed KTX2 array texture) at UV0 directly. The atlas
 * alpha is a tint mask for the vertex colour (stucco and asphalt take the
 * paint, glass and stone keep their own colour).
 */
function atlasMaterial(
  atlas: THREE.Texture,
  hero: THREE.Texture,
  surface: THREE.Texture,
  columns: number,
  rails = false,
  weathering = false,
) {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
  if (rails) {
    material.polygonOffset = true;
    material.polygonOffsetFactor = -2;
    material.polygonOffsetUnits = -4;
  }
  material.onBeforeCompile = (shader) => {
    shader.uniforms.atlas = { value: atlas };
    shader.uniforms.heroAtlas = { value: hero };
    shader.uniforms.surfaceAtlas = { value: surface };
    shader.uniforms.columns = { value: columns };
    shader.uniforms.weathering = { value: weathering ? 1 : 0 };
    shader.uniforms.padding = { value: 16 / (columns === 3 ? 512 : 256) };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec2 aUv0;
        attribute vec2 aInfo;
        attribute vec4 aTint;
        varying vec2 vAtlasUv;
        varying vec2 vInfo;
        varying vec3 vTint;
        varying vec3 vWorld;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vAtlasUv = aUv0;
        vInfo = aInfo;
        vTint = aTint.rgb;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D atlas;
        uniform highp sampler2DArray heroAtlas;
        uniform sampler2D surfaceAtlas;
        uniform float columns;
        uniform float padding;
        uniform float weathering;
        varying vec2 vAtlasUv;
        varying vec2 vInfo;
        varying vec3 vTint;
        varying vec3 vWorld;
        float zgHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float zgNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(zgHash(i), zgHash(i + vec2(1, 0)), u.x),
                     mix(zgHash(i + vec2(0, 1)), zgHash(i + vec2(1, 1)), u.x), u.y);
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `vec4 tex;
        if (vInfo.x < -50.0) {
          // -(100 + tile): a surface-atlas tile on a wall (church stone).
          float tile = -vInfo.x - 100.0;
          vec2 cell = vec2(mod(tile, 4.0), floor(tile / 4.0));
          float spad = 16.0 / 256.0; // the surface atlas's own cells
          float inner = 1.0 - 2.0 * spad;
          vec2 flipped = vec2(vAtlasUv.x, -vAtlasUv.y);
          vec2 atlasUv = (cell + vec2(spad) + fract(flipped) * inner) / 4.0;
          float scale = inner / 4.0;
          tex = textureGrad(surfaceAtlas, atlasUv, dFdx(flipped) * scale, dFdy(flipped) * scale);
        } else if (vInfo.x < -0.5) {
          // Derivatives outside the page branches: they are not uniform flow.
          vec2 hdx = dFdx(vAtlasUv), hdy = dFdy(vAtlasUv);
          float page = -vInfo.x - 1.0;
          tex = textureGrad(heroAtlas, vec3(vAtlasUv, floor(page + 0.5)), hdx, hdy);
        } else {
          float tile = floor(vInfo.x + 0.5);
          vec2 cell = vec2(mod(tile, columns), floor(tile / columns));
          float inner = 1.0 - 2.0 * padding;
          // v counts upward on a facade; image rows count downward.
          vec2 flipped = vec2(vAtlasUv.x, -vAtlasUv.y);
          vec2 atlasUv = (cell + vec2(padding) + fract(flipped) * inner) / columns;
          float scale = inner / columns;
          tex = textureGrad(atlas, atlasUv, dFdx(flipped) * scale, dFdy(flipped) * scale);
        }
        diffuseColor.rgb *= tex.rgb * mix(vec3(1.0), vTint, tex.a);
        if (weathering > 0.5 && vInfo.x > -0.5) {
          // Large-scale weathering, so a big roof is not one stamped tile
          // and still reads as a real roof from the street: patches of
          // darker and lighter tiles over a few metres, soot streaks.
          float n = zgNoise(vWorld.xz / 6.0) * 0.6 + zgNoise(vWorld.xz / 1.7) * 0.4;
          float streak = zgNoise(vec2(vWorld.x * 0.9 + vWorld.z * 0.3, vWorld.y * 0.15));
          diffuseColor.rgb *= mix(0.8, 1.14, n) * mix(0.9, 1.0, streak);
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        'float roughnessFactor = vInfo.y > 0.01 ? vInfo.y : 0.85;',
      );
  };
  // One program for all atlas materials of this kind.
  material.customProgramCacheKey = () => `city-atlas`;
  return material;
}

/**
 * The hero atlas: `textures/hero_atlas_<n>.ktx2`, one block-compressed page each (only the pages
 * that changed are re-encoded by tool/prepare_facades.py pack), merged here into ONE array
 * texture (layer = page), so the shader needs one texture unit however many pages there are.
 * The merge fills preallocated per-mip buffers a few pages at a time, so the JS heap holds the
 * array once, not every page plus a copy; the CPU copy is dropped after the GPU upload.
 */
async function loadHeroAtlas(loader: KTX2Loader, pages: number, anisotropy: number, onFraction: (f: number) => void = () => {}) {
  let mips: { data: Uint8Array; width: number; height: number }[] = [];
  let first: THREE.CompressedTexture | null = null;
  for (let start = 0; start < pages; start += 4) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(4, pages - start) }, (_, j) =>
        loader.loadAsync(`textures/hero_atlas_${start + j}.ktx2`),
      ),
    );
    batch.forEach((page, j) => {
      if (!first) {
        first = page;
        mips = page.mipmaps.map((m) => ({
          data: new Uint8Array(m.data.byteLength * pages),
          width: m.width,
          height: m.height,
        }));
      }
      page.mipmaps.forEach((m, level) => mips[level].data.set(m.data as Uint8Array, (start + j) * m.data.byteLength));
      if (page !== first) page.dispose();
    });
    onFraction(Math.min(1, (start + batch.length) / pages));
  }
  const f = first!;
  const atlas = new THREE.CompressedArrayTexture(mips, f.image.width, f.image.height, pages, f.format as THREE.CompressedPixelFormat, f.type);
  atlas.colorSpace = f.colorSpace;
  atlas.minFilter = THREE.LinearMipmapLinearFilter;
  atlas.magFilter = THREE.LinearFilter;
  atlas.generateMipmaps = false;
  atlas.wrapS = atlas.wrapT = THREE.ClampToEdgeWrapping;
  atlas.anisotropy = anisotropy;
  atlas.needsUpdate = true;
  // The GPU has it now; free the (hundreds of MB) CPU copy.
  atlas.onUpdate = () => {
    atlas.mipmaps = [];
  };
  f.dispose();
  return atlas;
}

function loadTexture(loader: KTX2Loader, url: string, anisotropy: number) {
  return loader.loadAsync(url).catch(() => {
    throw new Error(`could not load ${url}`);
  }).then((t) => {
    // The atlases address rows from the top (v = 0 is the first row), as a KTX2 stores them.
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = anisotropy;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    return t;
  });
}

// The production build ships the city gzipped (vite.config.ts: 19 MB -> 2.6 MB); a host may also
// have undone the gzip already (Content-Encoding), so look at the bytes, not the name.
async function loadGlb(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`could not load ${url}`);
  let bytes = await response.arrayBuffer();
  const head = new Uint8Array(bytes, 0, 2);
  if (head[0] === 0x1f && head[1] === 0x8b) {
    bytes = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  return new GLTFLoader().parseAsync(bytes, '');
}

export async function loadCity(
  renderer: THREE.WebGLRenderer,
  R: typeof RAPIER_NS,
  world: RAPIER_NS.World,
  onProgress: (label: string) => void,
  onFraction: (f: number) => void = () => {},
): Promise<City> {
  const anisotropy = renderer.capabilities.getMaxAnisotropy();
  onProgress('textures');
  const data = await fetch('city/city.json').then((r) => r.json() as Promise<CityData>);
  // The tiled atlases and the hero pages (one array texture) are ETC1S KTX2 with mips,
  // transcoded to what the GPU has.
  const ktx2 = new KTX2Loader().setTranscoderPath('basis/').detectSupport(renderer);
  const [facadeAtlas, surfaceAtlas, roofAtlas, heroAtlas] = await Promise.all([
    loadTexture(ktx2, 'textures/facade_atlas.ktx2', anisotropy),
    loadTexture(ktx2, 'textures/surface_atlas.ktx2', anisotropy),
    data.roofSet ? loadTexture(ktx2, 'textures/roof_atlas.ktx2', anisotropy) : Promise.resolve(null),
    loadHeroAtlas(ktx2, Math.max(1, data.heroPages ?? 1), anisotropy, onFraction),
  ]);
  ktx2.dispose();
  const materials: Record<string, THREE.Material> = {
    facade: atlasMaterial(facadeAtlas, heroAtlas, surfaceAtlas, 8),
    // The roof set (tool/prepare_roofs.py): 3 x 3 cells of 512 px.
    roof: roofAtlas
      ? atlasMaterial(roofAtlas, heroAtlas, surfaceAtlas, 3, false, true)
      : atlasMaterial(surfaceAtlas, heroAtlas, surfaceAtlas, 4, false, true),
    ground: atlasMaterial(surfaceAtlas, heroAtlas, surfaceAtlas, 4),
    rails: atlasMaterial(surfaceAtlas, heroAtlas, surfaceAtlas, 4, true),
  };

  onProgress('city');
  const gltf = await loadGlb(import.meta.env.PROD ? 'city/zagreb.glb.gz' : 'city/zagreb.glb');
  const optionalGrid = (url: string) =>
    fetch(url).then((r) => (r.ok ? (r.json() as Promise<Grid>) : null)).catch(() => null);
  const [groundGrid0, farGrid] = await Promise.all([optionalGrid('city/terrain.json'), optionalGrid('city/far.json')]);
  const groundGrid = groundGrid0 && data.dips?.length ? sinkGrid(groundGrid0, data.dips) : groundGrid0;
  const root = new THREE.Group();
  root.name = 'city';
  let lampGeometry: THREE.BufferGeometry | undefined;
  const propMat = propMaterial();
  const meshes: THREE.Mesh[] = [];
  gltf.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  for (const mesh of meshes) {
    // GLTFLoader sanitizes node names ('/' goes), so read the kind from the
    // placeholder material the exporter named.
    const kind = (mesh.material as THREE.Material).name;
    const g = mesh.geometry;
    if (kind === 'lamp') {
      lampGeometry = g;
      continue;
    }
    if (kind === 'glass') {
      // Shelter panes: see-through, drawn after the opaque city.
      mesh.material = new THREE.MeshPhysicalMaterial({
        color: 0xbfd6e0,
        roughness: 0.05,
        metalness: 0,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      mesh.renderOrder = 1;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      root.add(mesh);
      const pos = g.getAttribute('position').array as Float32Array;
      world.createCollider(R.ColliderDesc.trimesh(new Float32Array(pos), new Uint32Array(g.getIndex()!.array)));
      continue;
    }
    if (kind === 'ramp') {
      // The smooth slope under a flight of steps (data/levels.json): the car
      // drives on it, nobody sees it.
      const pos = g.getAttribute('position').array as Float32Array;
      world.createCollider(
        R.ColliderDesc.trimesh(new Float32Array(pos), new Uint32Array(g.getIndex()!.array)).setFriction(1),
      );
      g.dispose();
      continue;
    }
    if (kind === 'prop') {
      g.setAttribute('aInfo', g.getAttribute('uv1'));
      mesh.material = propMat;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      root.add(mesh);
      const pos = g.getAttribute('position').array as Float32Array;
      world.createCollider(
        R.ColliderDesc.trimesh(new Float32Array(pos), new Uint32Array(g.getIndex()!.array)).setFriction(0.3),
      );
      continue;
    }
    g.setAttribute('aUv0', g.getAttribute('uv'));
    g.setAttribute('aInfo', g.getAttribute('uv1'));
    g.setAttribute('aTint', g.getAttribute('color'));
    g.deleteAttribute('uv');
    g.deleteAttribute('uv1');
    g.deleteAttribute('color');
    // Steps are drawn like the ground; the ramp under them collides instead.
    mesh.material = materials[kind === 'steps' ? 'ground' : kind];
    mesh.castShadow = kind === 'facade' || kind === 'roof';
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    root.add(mesh);

    // Walls stop the car; the ground (with its kerbs) carries it.
    if (kind === 'facade' || kind === 'ground') {
      const pos = g.getAttribute('position').array as Float32Array;
      const index = new Uint32Array(g.getIndex()!.array);
      const desc = R.ColliderDesc.trimesh(new Float32Array(pos), index).setFriction(kind === 'ground' ? 1 : 0.2);
      world.createCollider(desc);
    }
  }

  onProgress('trees');
  root.add(await buildTrees(data.trees, R, world, anisotropy));

  if (lampGeometry) {
    lampGeometry.setAttribute('aInfo', lampGeometry.getAttribute('uv1'));
    // Its own material: one shared with the (not instanced) props mesh made three rebuild the
    // program parameters at every switch, every frame.
    const lamps = new THREE.InstancedMesh(lampGeometry, propMaterial(), data.lamps.length);
    const m = new THREE.Matrix4();
    data.lamps.forEach(([x, z, y], i) => {
      lamps.setMatrixAt(i, m.makeTranslation(x, y, z));
      world.createCollider(R.ColliderDesc.cylinder(2.3, 0.14).setTranslation(x, y + 2.3, z));
    });
    lamps.castShadow = true;
    lamps.computeBoundingSphere();
    root.add(lamps);
  }

  // Hand-placed features from data/buildings.json (signs, awnings...).
  const tables = [...(data.terraces ?? [])];
  if (data.features?.length) {
    onProgress('features');
    root.add(await buildFeatures(data.features, R, world, anisotropy, tables));
  }

  // The ground past the baked extent (the rest of the centre, not built
  // yet): the terrain grid a little below the streets, which cover it
  // inside the extent. A net under everything catches a car that slips.
  const [x0, z0, x1, z1] = data.extent;
  if (groundGrid) {
    const geo = gridGeometry(groundGrid, (_x, _z, h) => h - 0.25);
    // Muted grass-and-gravel, so the unbuilt part reads as ground, not as a
    // grey sea.
    const outside = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x7f8566, roughness: 1 }));
    outside.receiveShadow = true;
    root.add(outside);
    const net = gridGeometry(groundGrid, (_x, _z, h) => h - 0.6, 2);
    world.createCollider(
      R.ColliderDesc.trimesh(
        new Float32Array(net.getAttribute('position').array as Float32Array),
        new Uint32Array(net.getIndex()!.array),
      ),
    );
  } else {
    const outside = new THREE.Mesh(
      new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x8d877a, roughness: 1 }),
    );
    outside.position.y = -0.04;
    outside.receiveShadow = true;
    root.add(outside);
    world.createCollider(R.ColliderDesc.cuboid(3000, 1, 3000).setTranslation(0, -1.02, 0));
  }
  // Walls at the edge of the extent keep the car in the city; tall enough
  // for any slope.
  const pad = 2;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hx = (x1 - x0) / 2 + pad, hz = (z1 - z0) / 2 + pad;
  for (const [x, z, sx, sz] of [
    [cx, z0 - pad, hx, 0.5],
    [cx, z1 + pad, hx, 0.5],
    [x0 - pad, cz, 0.5, hz],
    [x1 + pad, cz, 0.5, hz],
  ]) {
    world.createCollider(R.ColliderDesc.cuboid(sx, 120, sz).setTranslation(x, 0, z));
  }
  // Fenced-off scenery (the Gornji Grad hill): the buildings stay, the car cannot get in.
  for (const [bx0, bz0, bx1, bz1] of data.blocked ?? []) {
    const bcx = (bx0 + bx1) / 2, bcz = (bz0 + bz1) / 2, bhx = (bx1 - bx0) / 2, bhz = (bz1 - bz0) / 2;
    for (const [x, z, sx, sz] of [
      [bcx, bz0, bhx, 0.5],
      [bcx, bz1, bhx, 0.5],
      [bx0, bcz, 0.5, bhz],
      [bx1, bcz, 0.5, bhz],
    ]) {
      world.createCollider(R.ColliderDesc.cuboid(sx, 120, sz).setTranslation(x, 0, z));
    }
  }
  // Hand-built landmarks and the fences round what the player may not enter.
  for (const l of data.landmarks ?? []) {
    if (l.name === 'cathedral') root.add(buildCathedral(l, R, world));
  }
  if (data.fences?.length) root.add(buildFences(data.fences, R, world));
  if (data.gates?.length || data.stoneWalls?.length) root.add(buildGates(data.gates ?? [], data.stoneWalls ?? [], R, world));
  if (data.passages?.length) root.add(buildPassages(data.passages, R, world, anisotropy));
  return { root, data, ground: groundGrid, far: farGrid, tables };
}
