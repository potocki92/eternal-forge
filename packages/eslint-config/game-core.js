import { baseConfig } from './base.js';

/**
 * `packages/game-core` must stay framework-independent and deterministic.
 *
 * These rules are the machine-checkable half of that contract; the other half is
 * the manifest guard test inside the package itself.
 */
const FORBIDDEN_IMPORTS = [
  {
    group: ['react', 'react/*', 'react-dom', 'react-dom/*'],
    message: 'game-core must not depend on React.',
  },
  { group: ['next', 'next/*'], message: 'game-core must not depend on Next.js.' },
  { group: ['@nestjs/*'], message: 'game-core must not depend on NestJS.' },
  { group: ['@prisma/*', 'prisma', 'prisma/*'], message: 'game-core must not depend on Prisma.' },
  { group: ['@supabase/*'], message: 'game-core must not depend on Supabase.' },
  { group: ['ioredis', 'redis', 'bullmq'], message: 'game-core must not depend on Redis/BullMQ.' },
  { group: ['pixi.js', 'pixi.js/*'], message: 'game-core must not depend on PixiJS.' },
  { group: ['axios', 'node-fetch', 'undici', 'got'], message: 'game-core must not perform I/O.' },
  {
    group: ['node:*', 'fs', 'path', 'http', 'https', 'crypto', 'os', 'child_process'],
    message: 'game-core must run without Node built-ins so it stays portable and testable.',
  },
  {
    group: [
      '@eternal-forge/database',
      '@eternal-forge/database/*',
      '@eternal-forge/config',
      '@eternal-forge/config/*',
      '@eternal-forge/ui',
      '@eternal-forge/ui/*',
    ],
    message: 'game-core must not depend on infrastructure or presentation packages.',
  },
];

export const gameCoreConfig = [
  ...baseConfig,
  {
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': ['error', { patterns: FORBIDDEN_IMPORTS }],
      // Determinism: gameplay logic must go through the RNG abstraction.
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Use the deterministic RNG abstraction instead of Math.random().',
        },
        {
          object: 'Date',
          property: 'now',
          message: 'Pass time in explicitly; game-core must not read the ambient clock.',
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'game-core must not touch the browser.' },
        { name: 'document', message: 'game-core must not touch the DOM.' },
        { name: 'fetch', message: 'game-core must not perform I/O.' },
      ],
    },
  },
  {
    // Architecture guard tests must read the filesystem to inspect the package
    // manifest and sources; the purity rules apply to shipped code, not to the
    // test that enforces them.
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': 'off',
      'no-restricted-properties': 'off',
      'no-restricted-globals': 'off',
    },
  },
];

export default gameCoreConfig;
