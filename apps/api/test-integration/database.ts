import { loadApiEnv } from '@eternal-forge/config/server';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service.js';

/**
 * A PrismaService against the database named by `DATABASE_URL`, which must
 * already be migrated (`pnpm run db:deploy`). Fails loudly rather than
 * skipping: an integration suite that silently does nothing proves nothing.
 */
export function connectTestDatabase(): PrismaService {
  const databaseUrl = process.env['DATABASE_URL'];
  if (databaseUrl === undefined) {
    throw new Error('DATABASE_URL must point at a migrated PostgreSQL to run integration tests.');
  }

  return new PrismaService(
    loadApiEnv({
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      REDIS_URL: 'redis://127.0.0.1:6379',
      SUPABASE_URL: 'https://test-project.supabase.co',
    }),
  );
}

export async function resetPlayerTables(prisma: PrismaService): Promise<void> {
  await prisma.client.$executeRawUnsafe('TRUNCATE TABLE "characters", "profiles" CASCADE');
}
