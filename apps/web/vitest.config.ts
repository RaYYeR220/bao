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
    // tests against live devnet run only when asked for: LIVE_TESTS=1
    exclude: process.env.LIVE_TESTS ? [] : ['test/**/*.live.test.ts'],
  },
});
