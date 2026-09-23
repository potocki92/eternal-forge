import {
  STAGE_NUMBER_WIRE_MAX,
  characterSchema,
  stageNumberSchema,
} from '@eternal-forge/contracts';
import { STAGE_NUMBER_MAX, StageNumber } from '@eternal-forge/game-core';
import { describe, expect, it } from 'vitest';
import type { Character } from '../domain/player.js';
import { toCharacterDto } from './player.mapper.js';

function character(stage: StageNumber): Character {
  return {
    id: '5b0f6c1e-8f0e-4d8a-9d55-3b0f1b1f0a11',
    profileId: '0c9f3f0e-6a55-4b3a-8a8e-2b7b7a7e6c21',
    slot: 1,
    name: 'Ember',
    level: 1,
    stage,
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
      const dto = toCharacterDto(character(StageNumber.of(value)));

      expect(characterSchema.parse(dto).stage).toBe(value.toString());
      expect(StageNumber.parse(dto.stage).toBigInt()).toBe(value);
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
