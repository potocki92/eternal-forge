import { z } from 'zod';
import { urlWithProtocol } from './primitives.js';

export const redisEnvSchema = z.object({
  REDIS_URL: urlWithProtocol(['redis:', 'rediss:'], 'Redis'),
});

export type RedisEnv = z.infer<typeof redisEnvSchema>;
