import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ApiException } from '../../common/http/api-exception.js';
import {
  ACCESS_TOKEN_VERIFIER,
  AccessTokenRejectedError,
  AccessTokenVerificationUnavailableError,
  type AccessTokenVerifier,
} from '../application/ports/access-token-verifier.port.js';
import { extractBearerToken } from './bearer-token.js';
import { IS_PUBLIC } from './public.decorator.js';
import { setRequestIdentity } from './request-identity.js';

const REALM = 'Bearer realm="eternal-forge"';

/**
 * Global authentication guard: every route requires a verified access token
 * unless marked `@Public()` (ADR-016).
 *
 * Failures are reported per RFC 6750. Log lines carry the rejection reason and
 * never the token.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(ACCESS_TOKEN_VERIFIER) private readonly verifier: AccessTokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const extraction = extractBearerToken(request.header('authorization'));

    if (extraction.kind === 'missing') {
      throw unauthenticated('Authentication is required.', REALM);
    }
    if (extraction.kind === 'malformed') {
      throw unauthenticated('The access token is malformed.', `${REALM}, error="invalid_request"`);
    }

    try {
      setRequestIdentity(request, await this.verifier.verify(extraction.token));
      return true;
    } catch (error) {
      if (error instanceof AccessTokenRejectedError) {
        this.logger.debug(`Access token rejected (${error.reason})`);
        throw unauthenticated(
          error.reason === 'expired' ? 'The session has expired.' : 'The access token is invalid.',
          `${REALM}, error="invalid_token"`,
        );
      }
      if (error instanceof AccessTokenVerificationUnavailableError) {
        this.logger.warn('Access token verification unavailable: signing keys unreachable');
        throw new ApiException(
          HttpStatus.SERVICE_UNAVAILABLE,
          'AUTH_UNAVAILABLE',
          'Sign-in cannot be verified right now. Please try again shortly.',
          { headers: { 'retry-after': '5' } },
        );
      }
      throw error;
    }
  }
}

function unauthenticated(message: string, challenge: string): ApiException {
  return new ApiException(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', message, {
    headers: { 'www-authenticate': challenge },
  });
}
