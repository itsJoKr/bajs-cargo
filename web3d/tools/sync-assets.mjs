// Copies the texture atlases from ../assets/textures (the city pipeline's
// atlases) and the Draco decoder the car model needs into public/.
// Runs before `npm run dev` and `npm run build`.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const assets = `${root}../assets/textures`;
mkdirSync(`${root}public/textures`, { recursive: true });
// The tiled atlases ship as ETC1S KTX2 (a fifth of the PNG download, a quarter of the GPU memory).
// The PNGs stay the source: a PNG whose hash differs from atlas_ktx2.json is re-encoded (basisu,
// ~15 s) and the KTX2 committed beside it, so a checkout without basisu still runs.
const hashesFile = `${assets}/atlas_ktx2.json`;
const hashes = existsSync(hashesFile) ? JSON.parse(readFileSync(hashesFile, 'utf8')) : {};
for (const name of ['facade_atlas', 'surface_atlas', 'roof_atlas']) {
  rmSync(`${root}public/textures/${name}.png`, { force: true });
  // The roof atlas only exists once tool/prepare_roofs.py has run.
  if (!existsSync(`${assets}/${name}.png`)) continue;
  const hash = createHash('sha1').update(readFileSync(`${assets}/${name}.png`)).digest('hex');
  if (hashes[name] !== hash || !existsSync(`${assets}/${name}.ktx2`)) {
    console.log(`encoding ${name}.ktx2`);
    const tmp = `${assets}/${name}.tmp.ktx2`;
    const r = spawnSync('basisu', ['-ktx2', '-q', '255', '-comp_level', '3', '-mipmap', '-output_file', tmp, `${assets}/${name}.png`], {
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    if (r.error || r.status !== 0) {
      throw new Error(`basisu failed on ${name}.png (brew install basis_universal): ${r.error?.message ?? `exit ${r.status}`}`);
    }
    renameSync(tmp, `${assets}/${name}.ktx2`);
    hashes[name] = hash;
    writeFileSync(hashesFile, `${JSON.stringify(hashes, null, 2)}\n`);
  }
  cpSync(`${assets}/${name}.ktx2`, `${root}public/textures/${name}.ktx2`);
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
// The delivery destinations (data/deliveries.json) are read by the game as city/deliveries.json.
if (existsSync(`${root}../data/deliveries.json`)) {
  mkdirSync(`${root}public/city`, { recursive: true });
  cpSync(`${root}../data/deliveries.json`, `${root}public/city/deliveries.json`);
}
