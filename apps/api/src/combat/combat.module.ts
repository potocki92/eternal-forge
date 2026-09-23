import { Module } from '@nestjs/common';
import { PrismaModule } from '../infrastructure/prisma/prisma.module.js';
import { COMBAT_REPOSITORY } from './application/ports/combat-repository.port.js';
import { COMBAT_SEED_SOURCE } from './application/ports/combat-seed-source.port.js';
import { RunCombatUseCase } from './application/run-combat.use-case.js';
import { CryptoCombatSeedSource } from './infrastructure/crypto-combat-seed-source.js';
import { PrismaCombatRepository } from './infrastructure/prisma-combat.repository.js';
import { CombatController } from './presentation/combat.controller.js';

/** The server-authoritative combat transaction (ADR-019). */
@Module({
  imports: [PrismaModule],
  controllers: [CombatController],
  providers: [
    { provide: COMBAT_REPOSITORY, useClass: PrismaCombatRepository },
    { provide: COMBAT_SEED_SOURCE, useClass: CryptoCombatSeedSource },
    RunCombatUseCase,
  ],
})
export class CombatModule {}
