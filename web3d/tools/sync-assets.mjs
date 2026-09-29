// Copies the texture atlases from ../assets/textures (the city pipeline's
// atlases) and the Draco decoder the car model needs into public/.
// Runs before `npm run dev` and `npm run build`.
import { cpSync, existsSync, mkdirSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
mkdirSync(`${root}public/textures`, { recursive: true });
for (const name of ['facade_atlas.png', 'surface_atlas.png', 'hero_atlas.png', 'roof_atlas.png']) {
  // The roof atlas only exists once tool/prepare_roofs.py has run.
  if (existsSync(`${root}../assets/textures/${name}`)) {
    cpSync(`${root}../assets/textures/${name}`, `${root}public/textures/${name}`);
  }
}
cpSync(`${root}node_modules/three/examples/jsm/libs/draco/gltf`, `${root}public/draco`, { recursive: true });
