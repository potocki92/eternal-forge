import { Redis } from 'ioredis';

/**
 * Creates the Redis connection BullMQ requires.
 *
 * BullMQ blocks on `BRPOPLPUSH`-style commands, so `maxRetriesPerRequest` must
 * be `null`: any other value makes a blocking command fail during a reconnect.
 */
export function createQueueConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}
