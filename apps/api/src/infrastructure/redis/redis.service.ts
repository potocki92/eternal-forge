import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { ApiEnv } from '@eternal-forge/config/server';
import { Redis } from 'ioredis';
import { API_ENV } from '../../config/api-config.module.js';

/**
 * Owns the process-wide Redis connection.
 *
 * Redis is a cache, lock and queue transport. PostgreSQL remains the persistent
 * source of truth (docs/ARCHITECTURE.md — "Leaderboards").
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.client = new Redis(env.REDIS_URL, {
      // Connect in the background: a Redis outage must degrade readiness, not
      // block process start. `lazyConnect` is deliberately off — combined with
      // a disabled offline queue it would leave the client permanently
      // disconnected, since no command ever triggers the initial connect.
      maxRetriesPerRequest: 2,
      // Fail a command outright while disconnected instead of buffering it, so
      // a probe reports the outage rather than hanging on it.
      enableOfflineQueue: false,
    });

    // ioredis emits `error` on every reconnect attempt; an unhandled 'error'
    // event would crash the process.
    this.client.on('error', () => undefined);
  }

  async onModuleDestroy(): Promise<void> {
    this.client.disconnect();
    return Promise.resolve();
  }
}
