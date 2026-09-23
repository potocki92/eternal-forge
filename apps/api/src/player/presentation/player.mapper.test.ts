import {
  STAGE_NUMBER_WIRE_MAX,
  characterSchema,
  progressionSchema,
  stageNumberSchema,
} from '@eternal-forge/contracts';
import {
  HugeNumber,
  STAGE_NUMBER_MAX,
  StageNumber,
  type StageProgress,
} from '@eternal-forge/game-core';
import { describe, expect, it } from 'vitest';
import type { Character } from '../domain/player.js';
import { viewProgression } from '../domain/progression-view.js';
import { toCharacterDto, toProgressionDto } from './player.mapper.js';

/** A hero pushing its record on `stage`: every stage before it cleared. */
function pushingAt(stage: StageNumber): StageProgress {
  return {
    current: stage,
    highestReached: stage,
    highestCleared: stage.equals(StageNumber.FIRST) ? null : stage.stepBack(1),
  };
}

function character(stage: StageNumber, stages: StageProgress = pushingAt(stage)): Character {
  return {
    id: '5b0f6c1e-8f0e-4d8a-9d55-3b0f1b1f0a11',
    profileId: '0c9f3f0e-6a55-4b3a-8a8e-2b7b7a7e6c21',
    slot: 1,
    name: 'Ember',
    level: 1,
    stages,
    stageMode: 'PROGRESS',
    experience: HugeNumber.ZERO,
    gold: HugeNumber.fromDecimal('1e30'),
    nextCombatAt: new Date('2026-09-22T10:00:00.000Z'),
    createdAt: new Date('2026-09-22T10:00:00.000Z'),
    updatedAt: new Date('2026-09-22T10:00:00.000Z'),
  };
}

/**
 * The wire schema (contracts) and the domain value object (Game Core) describe
 * one format from two packages. These tests keep them from drifting apart.
 */
describe('stage number: domain ↔ wire', () => {
  it('agree on the maximum', () => {
    expect(STAGE_NUMBER_WIRE_MAX).toBe(STAGE_NUMBER_MAX.toString());
  });

  it.each([1n, 10n, 2n ** 53n + 1n, STAGE_NUMBER_MAX])(
    'maps stage %s to a string the shared contract accepts',
    (value) => {
      const dto = progressionSchema.parse(
        toProgressionDto(viewProgression(character(StageNumber.of(value)))),
      );

      expect(dto.currentStage).toBe(value.toString());
      expect(StageNumber.parse(dto.currentStage).toBigInt()).toBe(value);
      expect(dto.highestStageReached).toBe(value.toString());
    },
  );

  it.each(['0', '01', '+1', '1e3', '1.0', ' 1', '9223372036854775808', '9'.repeat(20)])(
    'reject %j in both places',
    (text) => {
      expect(stageNumberSchema.safeParse(text).success).toBe(false);
      expect(() => StageNumber.parse(text)).toThrow();
    },
  );
});

describe('stage progress: domain ↔ wire (ADR-020)', () => {
  it('sends a character that cleared nothing with highestStageCleared null', () => {
    const dto = progressionSchema.parse(
      toProgressionDto(viewProgression(character(StageNumber.FIRST))),
    );

    expect([dto.currentStage, dto.highestStageReached, dto.highestStageCleared]).toEqual([
      '1',
      '1',
      null,
    ]);
  });

  it('keeps the records apart from the current stage after a boss defeat', () => {
    const farming: StageProgress = {
      current: StageNumber.of(9),
      highestReached: StageNumber.of(10),
      highestCleared: StageNumber.of(9),
    };
    const dto = progressionSchema.parse(
      toProgressionDto(viewProgression(character(StageNumber.of(9), farming))),
    );

    expect([dto.currentStage, dto.highestStageReached, dto.highestStageCleared]).toEqual([
      '9',
      '10',
      '9',
    ]);
    // The encounter is the stage the hero will fight: the current one.
    expect(dto.encounter?.stage).toEqual({ number: '9', kind: 'REGULAR' });
  });

  it('carries records beyond 2^53 exactly', () => {
    const deep: StageProgress = {
      current: StageNumber.of(2n ** 53n),
      highestReached: StageNumber.of(2n ** 53n + 2n),
      highestCleared: StageNumber.of(2n ** 53n + 1n),
    };
    const dto = toProgressionDto(viewProgression(character(deep.current, deep)));

    expect(dto.highestStageReached).toBe('9007199254740994');
    expect(dto.highestStageCleared).toBe('9007199254740993');
  });

  it('puts no stage on the character itself', () => {
    expect(toCharacterDto(character(StageNumber.of(5)))).not.toHaveProperty('stage');
  });
});

describe('progression: domain ↔ wire', () => {
  it('sends gold and experience as canonical HugeNumbers the contract accepts', () => {
    const dto = toCharacterDto(character(StageNumber.FIRST));

    expect(characterSchema.parse(dto)).toMatchObject({ experience: '0', gold: '1e30' });
  });

  it.each([
    [1n, 'REGULAR'],
    [10n, 'BOSS'],
    [11n, 'REGULAR'],
    [20n, 'BOSS'],
  ] as const)('derives stage %s’s encounter (%s) from Game Core', (value, kind) => {
    const view = viewProgression(character(StageNumber.of(value)));
    const dto = progressionSchema.parse(toProgressionDto(view));

    expect(dto.encounter?.stage).toEqual({ number: value.toString(), kind });
    expect(dto.experienceToNextLevel).toBe('1e1');
    expect(dto.nextCombatAt).toBe('2026-09-22T10:00:00.000Z');
  });

  it('reports no encounter on a valid stage the rule set cannot scale', () => {
    const dto = progressionSchema.parse(
      toProgressionDto(viewProgression(character(StageNumber.of(STAGE_NUMBER_MAX)))),
    );

    expect(dto.encounter).toBeNull();
  });
});
