import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import pino from 'pino';
import {
  ACCESS_TOKEN_VERIFIER,
  type AccessTokenVerifier,
} from '../../src/auth/application/ports/access-token-verifier.port.js';
import { JoseAccessTokenVerifier } from '../../src/auth/infrastructure/jose-access-token-verifier.js';
import { AuthGuard } from '../../src/auth/presentation/auth.guard.js';
import { CLOCK, type Clock } from '../../src/common/clock/clock.port.js';
import { AllExceptionsFilter } from '../../src/common/http/all-exceptions.filter.js';
import { RequestIdMiddleware } from '../../src/common/http/request-id.middleware.js';
import { GetOwnedCharacterUseCase } from '../../src/player/application/get-owned-character.use-case.js';
import { GetPlayerStateUseCase } from '../../src/player/application/get-player-state.use-case.js';
import {
  PLAYER_REPOSITORY,
  type PlayerRepository,
} from '../../src/player/application/ports/player-repository.port.js';
import { ProvisionPlayerUseCase } from '../../src/player/application/provision-player.use-case.js';
import { PlayerController } from '../../src/player/presentation/player.controller.js';
import { TEST_AUDIENCE, TEST_ISSUER, type TestTokenIssuer } from './token-issuer.js';

export interface TestAppOptions {
  readonly issuer: TestTokenIssuer;
  readonly repository: PlayerRepository;
  readonly clock?: Clock;
  /** Replaces the real verifier; only for failure modes keys cannot produce. */
  readonly verifier?: AccessTokenVerifier;
}

/**
 * The player HTTP surface wired as production wires it — global guard, real
 * token verifier, real controller, use cases and exception filter — with the
 * repository supplied by the test and signing keys generated for the run.
 */
export async function createPlayerTestApp(options: TestAppOptions): Promise<INestApplication> {
  const clock = options.clock ?? { now: () => new Date() };
  const moduleRef = await Test.createTestingModule({
    controllers: [PlayerController],
    providers: [
      { provide: CLOCK, useValue: clock },
      {
        provide: ACCESS_TOKEN_VERIFIER,
        useValue:
          options.verifier ??
          new JoseAccessTokenVerifier({
            issuer: TEST_ISSUER,
            audience: TEST_AUDIENCE,
            keys: options.issuer.jwks,
            clock,
          }),
      },
      { provide: APP_GUARD, useClass: AuthGuard },
      { provide: PLAYER_REPOSITORY, useValue: options.repository },
      GetPlayerStateUseCase,
      ProvisionPlayerUseCase,
      GetOwnedCharacterUseCase,
    ],
  }).compile();

  const app = moduleRef.createNestApplication({ logger: false });
  const requestId = new RequestIdMiddleware();
  app.use(requestId.use.bind(requestId));
  app.useGlobalFilters(new AllExceptionsFilter(pino({ level: 'silent' })));
  await app.init();
  return app;
}

/**
 * Nest declares `getHttpServer()` as `any`. With the Express adapter it returns
 * the underlying Node HTTP server, which is what supertest needs; the assertion
 * is confined to this one helper.
 */
export function httpServer(application: INestApplication): Server {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return application.getHttpServer();
}
