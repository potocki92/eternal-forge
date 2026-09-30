import { Module } from '@nestjs/common';
import { PrismaModule } from '../infrastructure/prisma/prisma.module.js';
import {
  GetCharacterStatsUseCase,
  PreviewEquipmentChangeUseCase,
} from './application/character-stats.use-cases.js';
import { CHARACTER_STATS_REPOSITORY } from './application/ports/character-stats-repository.port.js';
import { PrismaCharacterStatsRepository } from './infrastructure/prisma-character-stats.repository.js';
import { CharacterStatsController } from './presentation/character-stats.controller.js';

/** Server-authoritative character stat and equipment-preview queries (ADR-030). */
@Module({
  imports: [PrismaModule],
  controllers: [CharacterStatsController],
  providers: [
    { provide: CHARACTER_STATS_REPOSITORY, useClass: PrismaCharacterStatsRepository },
    GetCharacterStatsUseCase,
    PreviewEquipmentChangeUseCase,
  ],
})
export class CharacterStatsModule {}
