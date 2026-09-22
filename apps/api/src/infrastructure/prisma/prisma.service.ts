import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { ApiEnv } from '@eternal-forge/config/server';
import { createPrismaClient, type PrismaClient } from '@eternal-forge/database';
import { API_ENV } from '../../config/api-config.module.js';

/**
 * Owns the process-wide Prisma client.
 *
 * Repository implementations depend on this service; application and domain code
 * depend on repository *ports* and never see Prisma (CLAUDE.md — "Persistence").
 *
 * The client is not connected eagerly: the `pg` adapter opens connections lazily,
 * so a database outage at boot degrades readiness instead of preventing startup.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.client = createPrismaClient({
      databaseUrl: env.DATABASE_URL,
      logQueries: env.NODE_ENV === 'development',
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
