import type { NextConfig } from 'next';
import { assertDeployableEnvironment } from './src/config/deployment-guard';

// Fails the build on a misconfigured deployment (docs/DEPLOYMENT.md).
assertDeployableEnvironment(process.env);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `@eternal-forge/ui` ships TypeScript source rather than a build artefact, so
  // the application compiles it with the same settings as its own code.
  transpilePackages: ['@eternal-forge/ui'],
  typedRoutes: true,
};

export default nextConfig;
