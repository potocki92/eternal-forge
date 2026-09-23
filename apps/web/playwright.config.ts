import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env['E2E_PORT'] ?? 3100);
const baseURL = `http://127.0.0.1:${PORT}`;

/** The web build's defaults (packages/config) point at these two. */
const API_PORT = 3001;
const AUTH_PORT = 54329;

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://forge:forge@127.0.0.1:5432/eternal_forge';

/**
 * End-to-end suite.
 *
 * Runs the production web build against the real API and PostgreSQL. Only the
 * identity provider is substituted: a Supabase Auth test double that issues
 * real ES256 tokens, which the API verifies with its production code path
 * (ADR-016). PostgreSQL must be running and migrated (`pnpm run db:deploy`).
 *
 * The primary project is the 390x844 design viewport; desktop is verified in
 * addition, not instead (docs/UI_SYSTEM.md — "Mobile first").
 */
export default defineConfig({
  testDir: './e2e',
  testIgnore: ['support/**'],
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 2 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'pnpm run auth:stub',
      url: `http://127.0.0.1:${AUTH_PORT}/auth/v1/health`,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
    {
      command: 'node ../api/dist/main.js',
      url: `http://127.0.0.1:${API_PORT}/health`,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
      env: {
        NODE_ENV: 'test',
        LOG_LEVEL: 'warn',
        API_PORT: String(API_PORT),
        API_CORS_ORIGINS: baseURL,
        DATABASE_URL: databaseUrl,
        REDIS_URL: process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379',
        SUPABASE_URL: `http://127.0.0.1:${AUTH_PORT}`,
      },
    },
    {
      command: `pnpm run start --port ${PORT}`,
      url: baseURL,
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
  ],
});
