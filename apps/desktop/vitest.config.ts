import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@minutes/core': path.resolve(__dirname, '../../packages/core/src/index.ts'),
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
