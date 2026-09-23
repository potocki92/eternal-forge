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
 *
 * A message may be a structured event — a plain object with a `msg` string —
 * so application code can log fields a query can filter on, through Nest's
 * `Logger`, without formatting them into text:
 *
 * ```ts
 * logger.log({ msg: 'Combat refused', event: 'combat.not_ready', characterId });
 * ```
 */
export class PinoLoggerService implements LoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: unknown, context?: unknown): void {
    this.logger.info(...entry(message, { context }));
  }

  error(message: unknown, stack?: unknown, context?: unknown): void {
    this.logger.error(...entry(message, { context, stack }));
  }

  warn(message: unknown, context?: unknown): void {
    this.logger.warn(...entry(message, { context }));
  }

  debug(message: unknown, context?: unknown): void {
    this.logger.debug(...entry(message, { context }));
  }

  verbose(message: unknown, context?: unknown): void {
    this.logger.trace(...entry(message, { context }));
  }
}

/** A structured event: fields to record, and the human-readable line. */
export interface LogEvent {
  readonly msg: string;
  readonly [field: string]: unknown;
}

function isLogEvent(message: unknown): message is LogEvent {
  return (
    typeof message === 'object' &&
    message !== null &&
    !Array.isArray(message) &&
    !(message instanceof Error) &&
    'msg' in message &&
    typeof message.msg === 'string'
  );
}

/** pino's `(fields, message)` pair for a text message or a structured event. */
function entry(message: unknown, base: Record<string, unknown>): [Record<string, unknown>, string] {
  if (isLogEvent(message)) {
    const { msg, ...fields } = message;
    // The caller's fields never overwrite the logger's own context.
    return [{ ...fields, ...base }, msg];
  }
  return [base, String(message)];
}
