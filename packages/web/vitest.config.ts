import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@pathblender/core': fileURLToPath(
        new URL('../core/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['test/**/*.test.tsx', 'test/**/*.test.ts'],
    // Generation-heavy tests + slow jsdom startup under parallel workspace runs.
    testTimeout: 30000,
  },
});
