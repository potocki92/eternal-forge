import pino, { type Logger } from 'pino';

export const SERVICE_NAME = 'eternal-forge-worker';

/**
 * Structured logger for the worker process.
 *
 * Job payloads may reference player-owned resources, so credential-shaped fields
 * are redacted before anything reaches a log sink (docs/SECURITY.md — "Logging").
 */
export function createLogger(level: string, pretty: boolean, version: string): Logger {
  return pino({
    level,
    base: { service: SERVICE_NAME, version },
    redact: {
      paths: ['password', '*.password', 'accessToken', '*.accessToken', 'serviceRoleKey'],
      censor: '[redacted]',
    },
    ...(pretty ? { transport: { target: 'pino-pretty', options: { singleLine: true } } } : {}),
  });
}
