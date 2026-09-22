import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration.
 *
 * Prisma 7 removed `url`/`directUrl` from `schema.prisma`; connection strings
 * for Migrate and Introspect live here, and the runtime client receives its
 * connection through a driver adapter instead.
 *
 * Migrate must use a *direct* connection: DDL cannot run through Supabase's
 * transaction pooler. `DIRECT_URL` is therefore preferred, falling back to
 * `DATABASE_URL` for local development where both are the same server.
 */
loadDotenv({ path: ['.env', '../../.env'], quiet: true });

const migrationUrl = process.env['DIRECT_URL'] ?? process.env['DATABASE_URL'];

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Omitted entirely when unset so `prisma generate` works without a database,
  // which is what CI and a fresh clone need.
  ...(migrationUrl === undefined ? {} : { datasource: { url: migrationUrl } }),
});
