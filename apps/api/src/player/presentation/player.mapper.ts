import type {
  CharacterDto,
  EncounterDto,
  PlayerStateResponse,
  ProgressionDto,
  StageProgressDto,
} from '@eternal-forge/contracts';
import type { Enemy, StageProgress } from '@eternal-forge/game-core';
import type { Character, Player } from '../domain/player.js';
import type { ProgressionView } from '../domain/progression-view.js';

/** Domain → shared contract. The internal `authUserId` never leaves the API. */
export function toPlayerStateResponse(
  player: Player,
  progression: ProgressionView,
  serverTime: Date,
): PlayerStateResponse {
  return {
    profile: {
      id: player.profile.id,
      displayName: player.profile.displayName,
      createdAt: player.profile.createdAt.toISOString(),
    },
    character: toCharacterDto(player.mainCharacter),
    progression: toProgressionDto(progression),
    serverTime: serverTime.toISOString(),
  };
}

export function toCharacterDto(character: Character): CharacterDto {
  return {
    id: character.id,
    slot: character.slot,
    name: character.name,
    level: character.level,
    experience: character.experience.toString(),
    gold: character.gold.toString(),
    createdAt: character.createdAt.toISOString(),
  };
}

export function toProgressionDto(view: ProgressionView): ProgressionDto {
  return {
    ...toStageProgressDto(view.stages),
    experienceToNextLevel: view.experienceToNextLevel.toString(),
    hero: {
      maxHealth: view.character.stats.maxHealth.toString(),
      damage: view.character.stats.damage.toString(),
    },
    encounter: view.encounter === null ? null : toEncounterDto(view.encounter),
    nextCombatAt: view.nextCombatAt.toISOString(),
  };
}

/** Exact canonical strings; `null` stays `null` before the first clear (ADR-020). */
export function toStageProgressDto(stages: StageProgress): StageProgressDto {
  return {
    currentStage: stages.current.toString(),
    highestStageReached: stages.highestReached.toString(),
    highestStageCleared: stages.highestCleared?.toString() ?? null,
  };
}

/** An enemy with the stage it defends, classified by Game Core. */
export function toEncounterDto(enemy: Enemy): EncounterDto {
  return {
    stage: { number: enemy.stage.number.toString(), kind: enemy.stage.kind },
    enemy: {
      archetypeId: enemy.archetypeId,
      maxHealth: enemy.stats.maxHealth.toString(),
      damage: enemy.stats.damage.toString(),
    },
  };
}
