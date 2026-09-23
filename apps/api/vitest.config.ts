import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * NestJS relies on `emitDecoratorMetadata`, which esbuild (Vitest's default
 * transformer) does not implement. SWC is used instead so dependency injection
 * behaves in tests exactly as it does at runtime.
 */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    environment: 'node',
    setupFiles: ['test/support/silence-nest-logger.ts'],
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
