import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { defineConfig, type Plugin } from 'vite';

// The build ships the city glb gzipped (19 MB -> 2.6 MB, lossless): hosts do not compress .glb
// on their own. city.ts unzips it with DecompressionStream; dev serves the plain file.
function gzipCity(): Plugin {
  let outDir = 'dist';
  return {
    name: 'gzip-city',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const glb = `${outDir}/city/zagreb.glb`;
      if (!existsSync(glb)) return;
      writeFileSync(`${glb}.gz`, gzipSync(readFileSync(glb), { level: 9 }));
      rmSync(glb);
    },
  };
}

export default defineConfig({
  server: { host: true, port: 5180 },
  build: { target: 'es2022', chunkSizeWarningLimit: 6000 },
  plugins: [gzipCity()],
});
