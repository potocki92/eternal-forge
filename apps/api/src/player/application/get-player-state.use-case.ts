import { Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedIdentity } from '../../auth/application/authenticated-identity.js';
import { CLOCK, type Clock } from '../../common/clock/clock.port.js';
import type { Player } from '../domain/player.js';
import { viewProgression, type ProgressionView } from '../domain/progression-view.js';
import { PLAYER_REPOSITORY, type PlayerRepository } from './ports/player-repository.port.js';

export type GetPlayerStateResult =
  | {
      readonly kind: 'found';
      readonly player: Player;
      readonly progression: ProgressionView;
      readonly serverTime: Date;
    }
  | { readonly kind: 'not-provisioned' };

/** Query: the caller's own player state. */
@Injectable()
export class GetPlayerStateUseCase {
  constructor(
    @Inject(PLAYER_REPOSITORY) private readonly players: PlayerRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(identity: AuthenticatedIdentity): Promise<GetPlayerStateResult> {
    const player = await this.players.findByAuthUserId(identity.authUserId);

    return player === null
      ? { kind: 'not-provisioned' }
      : {
          kind: 'found',
          player,
          progression: viewProgression(player.mainCharacter),
          serverTime: this.clock.now(),
        };
  }
}
