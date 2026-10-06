import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    // every file boots its own in-memory Postgres
    hookTimeout: 60_000,
    // live devnet checks only run when asked for
    exclude: process.env.DEVNET_TESTS ? [] : ['test/**/*.devnet.test.ts'],
  },
});
