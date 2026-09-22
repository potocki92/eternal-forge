import { z } from 'zod';

export const nodeEnvSchema = z.enum(['development', 'test', 'production']).default('development');

export const logLevelSchema = z
  .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
  .default('info');

/** Runtime settings every server-side process shares. */
export const coreEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  LOG_LEVEL: logLevelSchema,
  /**
   * Release identifier reported by health endpoints and attached to every log
   * record. Deployments set it to the built revision; a local checkout reports a
   * development marker rather than a misleading version number.
   */
  SERVICE_VERSION: z.string().min(1).default('0.0.0-dev'),
});

export type CoreEnv = z.infer<typeof coreEnvSchema>;
