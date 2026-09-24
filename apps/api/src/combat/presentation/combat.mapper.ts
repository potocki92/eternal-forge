import type { CombatResponse, ProgressSnapshotDto } from '@eternal-forge/contracts';
import { ITEM_CATALOG } from '@eternal-forge/game-core';
import {
  toCharacterDto,
  toEncounterDto,
  toProgressionDto,
  toStageProgressDto,
} from '../../player/presentation/player.mapper.js';
import type { ProgressSnapshot, ResolvedCombat } from '../application/run-combat.use-case.js';

/**
 * Domain → shared contract. The seed, the idempotency key and every internal
 * id other than the combat's own never leave the API.
 */
export function toCombatResponse(combat: ResolvedCombat, serverTime: Date): CombatResponse {
  const { attempt, run } = combat;
  const encounter = toEncounterDto(attempt.enemy);

  return {
    combat: {
      id: run.id,
      stage: encounter.stage,
      enemy: encounter.enemy,
      hero: {
        maxHealth: attempt.character.stats.maxHealth.toString(),
        damage: attempt.character.stats.damage.toString(),
      },
      outcome: attempt.combat.outcome,
      endReason: attempt.combat.endReason,
      durationMs: attempt.combat.durationMs,
      events: attempt.combat.events.map((event) => ({
        timeMs: event.timeMs,
        attacker: event.attacker,
        critical: event.critical,
        damage: event.damage.toString(),
        targetHealth: event.targetHealth.toString(),
      })),
      rewards: {
        gold: attempt.rewards.gold.toString(),
        experience: attempt.rewards.experience.toString(),
        item:
          run.awardedItem === null
            ? null
            : (() => {
                const definition = ITEM_CATALOG.require(run.awardedItem.definitionId);
                return {
                  id: run.awardedItem.id.toString(),
                  definitionId: run.awardedItem.definitionId.toString(),
                  rarity: run.awardedItem.rarity,
                  nameKey: definition.nameKey,
                  slot: definition.slot,
                  createdAt: run.resolvedAt.toISOString(),
                };
              })(),
      },
      levelsGained: attempt.levelsGained,
      resolvedAt: run.resolvedAt.toISOString(),
    },
    before: toSnapshotDto(combat.before),
    after: toSnapshotDto(combat.after),
    character: toCharacterDto(combat.character),
    progression: toProgressionDto(combat.progression),
    serverTime: serverTime.toISOString(),
  };
}

function toSnapshotDto(snapshot: ProgressSnapshot): ProgressSnapshotDto {
  return {
    level: snapshot.level,
    experience: snapshot.experience.toString(),
    experienceToNextLevel: snapshot.experienceToNextLevel.toString(),
    gold: snapshot.gold.toString(),
    ...toStageProgressDto(snapshot.stages),
  };
}
