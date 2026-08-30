import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative base keeps the build deployable to a GitHub Pages subpath later.
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      // Consume the core workspace from TS source so dev/build never wait on
      // a core build step; the emitted package still resolves via exports.
      '@pathblender/core': fileURLToPath(
        new URL('../core/src/index.ts', import.meta.url),
      ),
    },
  },
});
