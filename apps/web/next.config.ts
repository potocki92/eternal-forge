import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `@eternal-forge/ui` ships TypeScript source rather than a build artefact, so
  // the application compiles it with the same settings as its own code.
  transpilePackages: ['@eternal-forge/ui'],
  typedRoutes: true,
};

export default nextConfig;
