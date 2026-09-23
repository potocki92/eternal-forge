import { Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedIdentity } from '../../auth/application/authenticated-identity.js';
import { CLOCK, type Clock } from '../../common/clock/clock.port.js';
import { MAIN_CHARACTER_SLOT, NEW_CHARACTER_STATE, type Player } from '../domain/player.js';
import { PlayerName } from '../domain/player-name.js';
import { viewProgression, type ProgressionView } from '../domain/progression-view.js';
import { PLAYER_REPOSITORY, type PlayerRepository } from './ports/player-repository.port.js';

export interface ProvisionPlayerCommand {
  readonly displayName: string;
  readonly characterName: string;
}

export interface ProvisionPlayerResult {
  readonly player: Player;
  readonly created: boolean;
  readonly progression: ProgressionView;
  readonly serverTime: Date;
}

/**
 * Command: Supabase user → Profile → main Character.
 *
 * Safe to retry and to race: the repository makes it atomic and idempotent, so
 * a double submit, a network retry or two tabs converge on one player
 * (ADR-017). The identity comes from the verified token only.
 *
 * @throws {InvalidPlayerNameError} when either name breaks the naming rule.
 */
@Injectable()
export class ProvisionPlayerUseCase {
  constructor(
    @Inject(PLAYER_REPOSITORY) private readonly players: PlayerRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(
    identity: AuthenticatedIdentity,
    command: ProvisionPlayerCommand,
  ): Promise<ProvisionPlayerResult> {
    const displayName = PlayerName.parse(command.displayName);
    const characterName = PlayerName.parse(command.characterName);

    const now = this.clock.now();
    const outcome = await this.players.provision({
      authUserId: identity.authUserId,
      displayName: displayName.value,
      characterName: characterName.value,
      characterSlot: MAIN_CHARACTER_SLOT,
      characterLevel: NEW_CHARACTER_STATE.level,
      characterStages: NEW_CHARACTER_STATE.stages,
      characterStageMode: NEW_CHARACTER_STATE.stageMode,
      characterExperience: NEW_CHARACTER_STATE.experience,
      characterGold: NEW_CHARACTER_STATE.gold,
      characterNextCombatAt: now,
    });

    return {
      ...outcome,
      progression: viewProgression(outcome.player.mainCharacter),
      serverTime: now,
    };
  }
}
