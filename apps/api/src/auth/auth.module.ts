import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { ApiEnv } from '@eternal-forge/config/server';
import { CLOCK, type Clock } from '../common/clock/clock.port.js';
import { API_ENV } from '../config/api-config.module.js';
import { ACCESS_TOKEN_VERIFIER } from './application/ports/access-token-verifier.port.js';
import {
  JoseAccessTokenVerifier,
  createSupabaseJwks,
  supabaseIssuer,
} from './infrastructure/jose-access-token-verifier.js';
import { AuthGuard } from './presentation/auth.guard.js';

/**
 * Authentication: Supabase Auth owns credentials and sessions; this module only
 * verifies the access tokens it issues (ADR-016).
 *
 * Registers {@link AuthGuard} globally, so authentication is the default for
 * every route in the application.
 */
@Module({
  providers: [
    {
      provide: ACCESS_TOKEN_VERIFIER,
      useFactory: (env: ApiEnv, clock: Clock) =>
        new JoseAccessTokenVerifier({
          issuer: supabaseIssuer(env.SUPABASE_URL),
          audience: env.AUTH_JWT_AUDIENCE,
          keys: createSupabaseJwks(env.SUPABASE_URL),
          ...(env.SUPABASE_JWT_SECRET === undefined
            ? {}
            : { legacySecret: env.SUPABASE_JWT_SECRET }),
          clock,
        }),
      inject: [API_ENV, CLOCK],
    },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AuthModule {}
