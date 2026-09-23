import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Integration suite against a real PostgreSQL (`pnpm run test:integration`).
 *
 * Kept out of `pnpm test` so the standard suite needs no services. CI runs it
 * in the job that provides PostgreSQL. Files run one at a time because they
 * share, and truncate, one database.
 */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    environment: 'node',
    setupFiles: ['test/support/silence-nest-logger.ts'],
    include: ['test-integration/**/*.int.test.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
