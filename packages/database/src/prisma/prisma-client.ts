import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/index.js';

export type { PrismaClient } from '../../generated/prisma/index.js';

export interface PrismaClientOptions {
  /** Pooled PostgreSQL connection string used at runtime. */
  readonly databaseUrl: string;
  /** Emits every executed statement. Never enable in production: queries carry player data. */
  readonly logQueries?: boolean;
  /** Upper bound on the connection pool owned by this process. */
  readonly maxConnections?: number;
}

/**
 * Builds a Prisma client backed by the `pg` driver adapter.
 *
 * Prisma 7 no longer reads the connection string from `schema.prisma`; the
 * adapter owns the connection. Injecting the URL rather than reading
 * `process.env` keeps the owning application responsible for validating its own
 * configuration (see `@eternal-forge/config/server`).
 */
export function createPrismaClient(options: PrismaClientOptions): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: options.databaseUrl,
    max: options.maxConnections ?? 10,
  });

  return new PrismaClient({
    adapter,
    log: options.logQueries === true ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
}

/**
 * The slice of the Prisma client a connectivity probe needs.
 *
 * Declaring the port instead of depending on the whole client keeps the probe
 * testable without a generated client or a database.
 */
export interface DatabaseProbeTarget {
  $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
}

/**
 * Cheapest possible round trip to PostgreSQL, used by readiness probes.
 *
 * Rejects with the driver error. Callers are responsible for turning a rejection
 * into a safe, non-sensitive message (docs/SECURITY.md — "Error handling").
 */
export async function pingDatabase(client: DatabaseProbeTarget): Promise<void> {
  await client.$queryRaw`SELECT 1`;
}
