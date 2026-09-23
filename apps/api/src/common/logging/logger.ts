import { type LoggerService } from '@nestjs/common';
import pino, { type Logger } from 'pino';
import { SERVICE_NAME } from '../../app-info.js';

/**
 * Paths scrubbed from every log record.
 *
 * Credentials must never reach a log sink, including through an error object
 * that happens to carry the originating request (docs/SECURITY.md — "Logging").
 */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'headers.authorization',
  'headers.cookie',
  'password',
  '*.password',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  // Supabase's own spelling, in case a session object reaches a log call.
  'access_token',
  '*.access_token',
  'refresh_token',
  '*.refresh_token',
  'token',
  '*.token',
  'serviceRoleKey',
  '*.serviceRoleKey',
];

export interface LoggerOptions {
  readonly level: string;
  readonly pretty: boolean;
  readonly version: string;
}

export function createPinoLogger(options: LoggerOptions): Logger {
  return pino({
    level: options.level,
    base: { service: SERVICE_NAME, version: options.version },
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
    ...(options.pretty
      ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
      : {}),
  });
}

/**
 * Adapts pino to Nest's `LoggerService` so framework output and application
 * output land in the same structured stream.
 */
export class PinoLoggerService implements LoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: unknown, context?: unknown): void {
    this.logger.info({ context }, String(message));
  }

  error(message: unknown, stack?: unknown, context?: unknown): void {
    this.logger.error({ context, stack }, String(message));
  }

  warn(message: unknown, context?: unknown): void {
    this.logger.warn({ context }, String(message));
  }

  debug(message: unknown, context?: unknown): void {
    this.logger.debug({ context }, String(message));
  }

  verbose(message: unknown, context?: unknown): void {
    this.logger.trace({ context }, String(message));
  }
}
