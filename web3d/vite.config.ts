import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: true, port: 5180 },
  build: { target: 'es2022', chunkSizeWarningLimit: 6000 },
});
