import { Module } from '@nestjs/common';
import { CryptoCombatSeedSource } from '../combat/infrastructure/crypto-combat-seed-source.js';
import { PrismaModule } from '../infrastructure/prisma/prisma.module.js';
import { ClaimOfflineProgressUseCase } from './application/claim-offline-progress.use-case.js';
import { OFFLINE_PROGRESS_REPOSITORY } from './application/ports/offline-progress-repository.port.js';
import { OFFLINE_SEED_SOURCE } from './application/ports/offline-seed-source.port.js';
import { PrismaOfflineProgressRepository } from './infrastructure/prisma-offline-progress.repository.js';
import { OfflineProgressController } from './presentation/offline-progress.controller.js';

/**
 * Offline progression (ADR-023): lazy, server-authoritative catch-up of a
 * character's idle time, on request. No scheduler, worker job or timer.
 */
@Module({
  imports: [PrismaModule],
  controllers: [OfflineProgressController],
  providers: [
    { provide: OFFLINE_PROGRESS_REPOSITORY, useClass: PrismaOfflineProgressRepository },
    // The same 256-bit CSPRNG source as combat seeds (ADR-019 §2).
    { provide: OFFLINE_SEED_SOURCE, useClass: CryptoCombatSeedSource },
    ClaimOfflineProgressUseCase,
  ],
})
export class OfflineModule {}
