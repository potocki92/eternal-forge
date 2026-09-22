import nextConfig from '@eternal-forge/eslint-config/next';

export default [
  ...nextConfig,
  {
    ignores: ['.next/**', 'next-env.d.ts', 'e2e/**', 'playwright.config.ts'],
  },
];
