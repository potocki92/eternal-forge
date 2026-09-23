import {
  GameCoreError,
  selectStage,
  type StageNumber,
  type StageSelection,
} from '@eternal-forge/game-core';
import { Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedIdentity } from '../../auth/application/authenticated-identity.js';
import { CLOCK, type Clock } from '../../common/clock/clock.port.js';
import type { Character } from '../domain/player.js';
import { viewProgression, type ProgressionView } from '../domain/progression-view.js';
import {
  STAGE_SELECTION_REPOSITORY,
  type StageSelectionRepository,
  type VersionedCharacter,
} from './ports/stage-selection-repository.port.js';

export interface SelectStageCommand {
  readonly characterId: string;
  /** The player's intent. Game Core decides whether it is allowed. */
  readonly selection: StageSelection;
}

export type SelectStageResult =
  | {
      readonly kind: 'selected';
      readonly character: Character;
      readonly progression: ProgressionView;
      readonly serverTime: Date;
    }
  | { readonly kind: 'not-found' }
  /** The farm stage lies beyond the highest stage reached. Nothing is written. */
  | { readonly kind: 'stage-locked'; readonly highestStageReached: StageNumber }
  /** The character kept changing under every attempt. Nothing is written. */
  | { readonly kind: 'conflict' };

/**
 * Attempts before giving up on a character that keeps changing. A selection
 * only races combats, which the pacing gate spaces by whole seconds, so a
 * second attempt practically always succeeds.
 */
export const SELECT_STAGE_MAX_ATTEMPTS = 3;

/**
 * Command: choose where the caller's character fights next (ADR-021).
 *
 * 1. Load the owned character and its version — one owner-scoped read.
 * 2. Game Core's `selectStage` validates the choice against the character's
 *    own records and returns the new stage progress. The API adds no rule.
 * 3. A choice that changes nothing writes nothing.
 * 4. One conditional `UPDATE … WHERE version = expected` writes the current
 *    stage and the mode, and advances the version, so a combat resolved from
 *    the previous state cannot commit afterwards (ADR-019 §5).
 * 5. If the version moved on, the choice is validated again against the fresh
 *    state and retried, a bounded number of times. The records only grow, so
 *    a stage that was unlocked stays unlocked.
 *
 * Setting a selection is naturally idempotent: repeating the request leaves
 * the same state, so it needs no idempotency key.
 */
@Injectable()
export class SelectStageUseCase {
  constructor(
    @Inject(STAGE_SELECTION_REPOSITORY) private readonly selections: StageSelectionRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(
    identity: AuthenticatedIdentity,
    command: SelectStageCommand,
  ): Promise<SelectStageResult> {
    for (let attempt = 1; attempt <= SELECT_STAGE_MAX_ATTEMPTS; attempt += 1) {
      const loaded = await this.selections.loadOwnedCharacter(
        identity.authUserId,
        command.characterId,
      );
      if (loaded === null) {
        return { kind: 'not-found' };
      }

      const outcome = await this.apply(identity, loaded, command.selection);
      if (outcome !== 'conflict') {
        return outcome;
      }
    }
    return { kind: 'conflict' };
  }

  private async apply(
    identity: AuthenticatedIdentity,
    { character, version }: VersionedCharacter,
    selection: StageSelection,
  ): Promise<SelectStageResult | 'conflict'> {
    let current: StageNumber;
    try {
      current = selectStage(character.stages, selection).current;
    } catch (error) {
      if (error instanceof GameCoreError && error.code === 'STAGE_LOCKED') {
        return { kind: 'stage-locked', highestStageReached: character.stages.highestReached };
      }
      throw error;
    }

    if (current.equals(character.stages.current) && selection.mode === character.stageMode) {
      return this.selected(character);
    }

    const saved = await this.selections.saveSelection({
      authUserId: identity.authUserId,
      characterId: character.id,
      expectedVersion: version,
      currentStage: current,
      stageMode: selection.mode,
    });
    return saved.kind === 'conflict' ? 'conflict' : this.selected(saved.character);
  }

  private selected(character: Character): SelectStageResult {
    return {
      kind: 'selected',
      character,
      progression: viewProgression(character),
      serverTime: this.clock.now(),
    };
  }
}
