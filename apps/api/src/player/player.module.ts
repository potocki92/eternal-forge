import { Module } from '@nestjs/common';
import { PrismaModule } from '../infrastructure/prisma/prisma.module.js';
import { GetOwnedCharacterUseCase } from './application/get-owned-character.use-case.js';
import { GetPlayerStateUseCase } from './application/get-player-state.use-case.js';
import { PLAYER_REPOSITORY } from './application/ports/player-repository.port.js';
import { STAGE_SELECTION_REPOSITORY } from './application/ports/stage-selection-repository.port.js';
import { ProvisionPlayerUseCase } from './application/provision-player.use-case.js';
import { SelectStageUseCase } from './application/select-stage.use-case.js';
import { PrismaPlayerRepository } from './infrastructure/prisma-player.repository.js';
import { PrismaStageSelectionRepository } from './infrastructure/prisma-stage-selection.repository.js';
import { PlayerController } from './presentation/player.controller.js';
import { StageSelectionController } from './presentation/stage-selection.controller.js';

/**
 * Player identity — profile, main character and the caller's own state — and
 * the character's stage selection (ADR-021).
 */
@Module({
  imports: [PrismaModule],
  controllers: [PlayerController, StageSelectionController],
  providers: [
    { provide: PLAYER_REPOSITORY, useClass: PrismaPlayerRepository },
    { provide: STAGE_SELECTION_REPOSITORY, useClass: PrismaStageSelectionRepository },
    GetPlayerStateUseCase,
    ProvisionPlayerUseCase,
    GetOwnedCharacterUseCase,
    SelectStageUseCase,
  ],
})
export class PlayerModule {}
