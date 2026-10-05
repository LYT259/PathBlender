import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

let gitHash = '';
try {
  gitHash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: fileURLToPath(new URL('.', import.meta.url)), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
} catch { /* Source archives have no commit identity. */ }
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative base keeps the build deployable to a GitHub Pages subpath later.
  base: './',
  define: { __PB_GIT_HASH__: JSON.stringify(gitHash) },
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
