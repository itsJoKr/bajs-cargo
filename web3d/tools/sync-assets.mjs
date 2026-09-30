// Copies the texture atlases from ../assets/textures (the city pipeline's
// atlases) and the Draco decoder the car model needs into public/.
// Runs before `npm run dev` and `npm run build`.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
mkdirSync(`${root}public/textures`, { recursive: true });
for (const name of ['facade_atlas.png', 'surface_atlas.png', 'roof_atlas.png']) {
  // The roof atlas only exists once tool/prepare_roofs.py has run.
  if (existsSync(`${root}../assets/textures/${name}`)) {
    cpSync(`${root}../assets/textures/${name}`, `${root}public/textures/${name}`);
  }
}
// Hero atlas pages: hero_atlas_<n>.ktx2, block-compressed (tool/prepare_facades.py pack), and the
// Basis transcoder that reads them.
for (const old of readdirSync(`${root}public/textures`)) {
  if (/^hero_atlas.*\.(png|ktx2)$/.test(old)) rmSync(`${root}public/textures/${old}`);
}
for (const name of readdirSync(`${root}../assets/textures`)) {
  if (/^hero_atlas_\d+\.ktx2$/.test(name)) {
    cpSync(`${root}../assets/textures/${name}`, `${root}public/textures/${name}`);
  }
}
cpSync(`${root}node_modules/three/examples/jsm/libs/basis`, `${root}public/basis`, { recursive: true });
cpSync(`${root}node_modules/three/examples/jsm/libs/draco/gltf`, `${root}public/draco`, { recursive: true });
