import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Accepts an inbound correlation id only when it is safe to echo.
 *
 * The value lands in logs and in a response header, so an unconstrained client
 * string would be a header-injection and log-forging vector. Anything that fails
 * the check is replaced with a fresh id rather than rejected: correlation is a
 * diagnostic aid, not an authorisation input.
 */
export function isSafeRequestId(value: string | undefined): value is string {
  return value !== undefined && /^[A-Za-z0-9._-]{8,128}$/u.test(value);
}

export function resolveRequestId(inbound: string | undefined): string {
  return isSafeRequestId(inbound) ? inbound : randomUUID();
}

/** Ensures every request carries a correlation id, echoed back to the caller. */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware<Request, Response> {
  use(request: Request, response: Response, next: NextFunction): void {
    const requestId = resolveRequestId(request.header(REQUEST_ID_HEADER));

    request.headers[REQUEST_ID_HEADER] = requestId;
    response.setHeader(REQUEST_ID_HEADER, requestId);
    next();
  }
}
