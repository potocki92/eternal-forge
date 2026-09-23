import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedIdentity } from '../application/authenticated-identity.js';
import { getRequestIdentity } from './request-identity.js';

/**
 * Injects the caller's verified identity into a route handler.
 *
 * Reaching it without an identity is a wiring error — a `@Public()` route
 * asking for the caller — and fails the request rather than proceeding
 * anonymously.
 */
export const CurrentIdentity = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedIdentity => {
    const identity = getRequestIdentity(context.switchToHttp().getRequest<Request>());

    if (identity === undefined) {
      throw new Error('CurrentIdentity used on a route that is not authenticated.');
    }

    return identity;
  },
);
