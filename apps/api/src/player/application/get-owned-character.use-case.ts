import { Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedIdentity } from '../../auth/application/authenticated-identity.js';
import type { Character } from '../domain/player.js';
import { PLAYER_REPOSITORY, type PlayerRepository } from './ports/player-repository.port.js';

/**
 * Query: one of the caller's characters by id.
 *
 * A character that exists but belongs to someone else is indistinguishable from
 * one that does not exist, so ids cannot be probed for ownership.
 */
@Injectable()
export class GetOwnedCharacterUseCase {
  constructor(@Inject(PLAYER_REPOSITORY) private readonly players: PlayerRepository) {}

  execute(identity: AuthenticatedIdentity, characterId: string): Promise<Character | null> {
    return this.players.findOwnedCharacter(identity.authUserId, characterId);
  }
}
