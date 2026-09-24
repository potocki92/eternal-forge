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
import {
  COMBAT_REPOSITORY,
  type CombatRepository,
} from '../../src/combat/application/ports/combat-repository.port.js';
import {
  COMBAT_SEED_SOURCE,
  type CombatSeedSource,
} from '../../src/combat/application/ports/combat-seed-source.port.js';
import { RunCombatUseCase } from '../../src/combat/application/run-combat.use-case.js';
import { CombatController } from '../../src/combat/presentation/combat.controller.js';
import { CLOCK, type Clock } from '../../src/common/clock/clock.port.js';
import { AllExceptionsFilter } from '../../src/common/http/all-exceptions.filter.js';
import { RequestIdMiddleware } from '../../src/common/http/request-id.middleware.js';
import {
  EquipItemUseCase,
  GetEquipmentUseCase,
  GetInventoryUseCase,
  UnequipItemUseCase,
} from '../../src/inventory/application/inventory.use-cases.js';
import {
  INVENTORY_REPOSITORY,
  type InventoryRepository,
} from '../../src/inventory/application/ports/inventory-repository.port.js';
import { InventoryController } from '../../src/inventory/presentation/inventory.controller.js';
import { ClaimOfflineProgressUseCase } from '../../src/offline/application/claim-offline-progress.use-case.js';
import {
  OFFLINE_PROGRESS_REPOSITORY,
  type OfflineProgressRepository,
} from '../../src/offline/application/ports/offline-progress-repository.port.js';
import {
  OFFLINE_SEED_SOURCE,
  type OfflineSeedSource,
} from '../../src/offline/application/ports/offline-seed-source.port.js';
import { OfflineProgressController } from '../../src/offline/presentation/offline-progress.controller.js';
import { GetOwnedCharacterUseCase } from '../../src/player/application/get-owned-character.use-case.js';
import { GetPlayerStateUseCase } from '../../src/player/application/get-player-state.use-case.js';
import {
  PLAYER_REPOSITORY,
  type PlayerRepository,
} from '../../src/player/application/ports/player-repository.port.js';
import {
  STAGE_SELECTION_REPOSITORY,
  type StageSelectionRepository,
} from '../../src/player/application/ports/stage-selection-repository.port.js';
import { ProvisionPlayerUseCase } from '../../src/player/application/provision-player.use-case.js';
import { SelectStageUseCase } from '../../src/player/application/select-stage.use-case.js';
import { PlayerController } from '../../src/player/presentation/player.controller.js';
import { StageSelectionController } from '../../src/player/presentation/stage-selection.controller.js';
import { TEST_AUDIENCE, TEST_ISSUER, type TestTokenIssuer } from './token-issuer.js';

export interface TestAppOptions {
  readonly issuer: TestTokenIssuer;
  readonly players: PlayerRepository;
  readonly combats: CombatRepository;
  readonly selections: StageSelectionRepository;
  /** Inventory/equipment routes exist only when a repository is supplied. */
  readonly inventory?: InventoryRepository;
  /** Offline progression (ADR-023). The routes exist only when it is given. */
  readonly offline?: OfflineProgressRepository;
  /** Defaults to {@link sequentialSeeds}, so combats are reproducible. */
  readonly seeds?: CombatSeedSource;
  /** Defaults to {@link sequentialSeeds} with an `offline` prefix. */
  readonly offlineSeeds?: OfflineSeedSource;
  readonly clock?: Clock;
  /** Replaces the real verifier; only for failure modes keys cannot produce. */
  readonly verifier?: AccessTokenVerifier;
}

/** Deterministic seeds `prefix-1`, `prefix-2`, … in place of the CSPRNG. */
export function sequentialSeeds(prefix = 'test-seed'): CombatSeedSource {
  let counter = 0;
  return {
    next: () => {
      counter += 1;
      return `${prefix}-${String(counter)}`;
    },
  };
}

/** A clock a test moves by hand. */
export class ManualClock implements Clock {
  constructor(private current: Date = new Date('2026-09-23T10:00:00.000Z')) {}

  now(): Date {
    return this.current;
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

/**
 * The player and combat HTTP surface wired as production wires it — global
 * guard, real token verifier, real controllers, use cases and exception
 * filter — with repositories supplied by the test and signing keys generated
 * for the run.
 */
export async function createTestApp(options: TestAppOptions): Promise<INestApplication> {
  const clock = options.clock ?? { now: () => new Date() };
  const offline =
    options.offline === undefined
      ? { controllers: [], providers: [] }
      : {
          controllers: [OfflineProgressController],
          providers: [
            { provide: OFFLINE_PROGRESS_REPOSITORY, useValue: options.offline },
            {
              provide: OFFLINE_SEED_SOURCE,
              useValue: options.offlineSeeds ?? sequentialSeeds('offline-seed'),
            },
            ClaimOfflineProgressUseCase,
          ],
        };
  const inventory =
    options.inventory === undefined
      ? { controllers: [], providers: [] }
      : {
          controllers: [InventoryController],
          providers: [
            { provide: INVENTORY_REPOSITORY, useValue: options.inventory },
            GetInventoryUseCase,
            GetEquipmentUseCase,
            EquipItemUseCase,
            UnequipItemUseCase,
          ],
        };
  const moduleRef = await Test.createTestingModule({
    controllers: [
      PlayerController,
      CombatController,
      StageSelectionController,
      ...offline.controllers,
      ...inventory.controllers,
    ],
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
      { provide: PLAYER_REPOSITORY, useValue: options.players },
      { provide: COMBAT_REPOSITORY, useValue: options.combats },
      { provide: STAGE_SELECTION_REPOSITORY, useValue: options.selections },
      { provide: COMBAT_SEED_SOURCE, useValue: options.seeds ?? sequentialSeeds() },
      GetPlayerStateUseCase,
      ProvisionPlayerUseCase,
      GetOwnedCharacterUseCase,
      RunCombatUseCase,
      SelectStageUseCase,
      ...offline.providers,
      ...inventory.providers,
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
