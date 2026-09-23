import { Module } from '@nestjs/common';
import { PrismaModule } from '../infrastructure/prisma/prisma.module.js';
import { GetOwnedCharacterUseCase } from './application/get-owned-character.use-case.js';
import { GetPlayerStateUseCase } from './application/get-player-state.use-case.js';
import { PLAYER_REPOSITORY } from './application/ports/player-repository.port.js';
import { ProvisionPlayerUseCase } from './application/provision-player.use-case.js';
import { PrismaPlayerRepository } from './infrastructure/prisma-player.repository.js';
import { PlayerController } from './presentation/player.controller.js';

/** Player identity: profile, main character and the caller's own state. */
@Module({
  imports: [PrismaModule],
  controllers: [PlayerController],
  providers: [
    { provide: PLAYER_REPOSITORY, useClass: PrismaPlayerRepository },
    GetPlayerStateUseCase,
    ProvisionPlayerUseCase,
    GetOwnedCharacterUseCase,
  ],
})
export class PlayerModule {}
