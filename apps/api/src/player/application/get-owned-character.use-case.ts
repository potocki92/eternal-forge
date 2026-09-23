import { Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedIdentity } from '../../auth/application/authenticated-identity.js';
import type { Character } from '../domain/player.js';
import { viewProgression, type ProgressionView } from '../domain/progression-view.js';
import { PLAYER_REPOSITORY, type PlayerRepository } from './ports/player-repository.port.js';

export interface OwnedCharacter {
  readonly character: Character;
  /** Derived by Game Core, including the stage progress (ADR-020). */
  readonly progression: ProgressionView;
}

/**
 * Query: one of the caller's characters by id, with its progression.
 *
 * A character that exists but belongs to someone else is indistinguishable from
 * one that does not exist, so ids cannot be probed for ownership.
 */
@Injectable()
export class GetOwnedCharacterUseCase {
  constructor(@Inject(PLAYER_REPOSITORY) private readonly players: PlayerRepository) {}

  async execute(
    identity: AuthenticatedIdentity,
    characterId: string,
  ): Promise<OwnedCharacter | null> {
    const character = await this.players.findOwnedCharacter(identity.authUserId, characterId);
    return character === null ? null : { character, progression: viewProgression(character) };
  }
}
