import { config as readDotenv } from 'dotenv';

/**
 * Loads `.env` files into `process.env` for local development.
 *
 * Variables already present in the environment win: a deployed process is
 * configured by its platform, and a stray file must never override that. In
 * production this is a no-op — deployments supply configuration directly and
 * ship no `.env` file (docs/SECURITY.md — "Secrets").
 *
 * Paths are resolved against the working directory, so both
 * `pnpm --filter @eternal-forge/api start` (from the app directory) and
 * `node apps/api/dist/main.js` (from the repository root) find the right file.
 * Missing files are ignored.
 */
export function loadEnvFiles(paths: readonly string[] = ['.env', '../../.env']): void {
  if (process.env['NODE_ENV'] === 'production') {
    return;
  }

  readDotenv({ path: [...paths], quiet: true });
}
