import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  GAME_RULES_VERSION,
  HugeNumber,
  createCharacter,
  getGameRules,
  simulateCombat,
  simulateStages,
} from '../src/index.js';

/**
 * Golden simulation fingerprints.
 *
 * Each fingerprint is the SHA-256 of `JSON.stringify(result)`. HugeNumbers
 * serialise canonically, so it covers every event, every roll and every value
 * in the result. A mismatch means a change altered the outcome of an existing
 * simulation. That is either a bug, or a rules change that needs a new rule set
 * and a GAME_RULES_VERSION bump (ADR-005). Never update a fingerprint without
 * that decision.
 */

const rules = getGameRules(GAME_RULES_VERSION);

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

describe(`golden simulations — rules v${GAME_RULES_VERSION}`, () => {
  it('headless demonstration: Stage 1 — WIN … Stage N — LOSS', () => {
    const result = simulateStages({
      character: createCharacter(1, rules),
      seed: 'demo',
      rulesVersion: GAME_RULES_VERSION,
      maxStages: 1_000,
    });

    const transcript = result.stages.map(
      (entry) => `Stage ${entry.stage.number} — ${entry.outcome}`,
    );
    expect(transcript).toEqual([
      'Stage 1 — WIN',
      'Stage 2 — WIN',
      'Stage 3 — WIN',
      'Stage 4 — WIN',
      'Stage 5 — WIN',
      'Stage 6 — WIN',
      'Stage 7 — WIN',
      'Stage 8 — WIN',
      'Stage 9 — WIN',
      'Stage 10 — LOSS',
    ]);
    expect(result.stages.at(-1)?.stage.kind).toBe('BOSS');
    expect(result.totalRewards.gold.toString()).toBe('7e1');
    expect(result.totalRewards.experience.toString()).toBe('3.6e1');
    expect(fingerprint(result)).toBe(
      'cfde996b9e818cf438135b8c567c0a74eee061080b7998e2a383a1f1de7d658b',
    );
  });

  it('a single combat ending on the time limit', () => {
    const result = simulateCombat({
      player: createCharacter(12, rules),
      enemy: {
        stats: {
          maxHealth: HugeNumber.fromNumber(900),
          damage: HugeNumber.fromDecimal('7.5'),
          attackSpeedBp: 12_000,
          critChanceBp: 1_000,
          critDamageBp: 20_000,
        },
      },
      seed: 'golden-combat',
      rulesVersion: GAME_RULES_VERSION,
    });

    expect(result.outcome).toBe('LOSS');
    expect(result.endReason).toBe('TIME_LIMIT');
    expect(result.events).toHaveLength(66);
    expect(result.player.criticalHits).toBe(3);
    expect(result.enemy.criticalHits).toBe(1);
    expect(result.player.remainingHealth.toString()).toBe('7.811670611e0');
    expect(fingerprint(result)).toBe(
      '81171fec2c398f89a18b2aa67c744924225e00a2363fc5bf461ac6addcdfdfdb',
    );
  });

  it.each([
    {
      level: 20,
      seed: 'golden-run',
      highest: 29,
      gold: '1.288e3',
      experience: '5.33e2',
      fingerprint: 'd12e6dd36ebb5ff77bca25dcd8660585b22fc1e3fa983f134f1d4a906fccffb3',
    },
    {
      level: 500,
      seed: 'golden-deep',
      highest: 429,
      gold: '6.66034073944804727e22',
      experience: '2.14701017404325436e19',
      fingerprint: 'e646b038440ad6f48571b1aac5b72313280f09c8d2ba088bbb5ca1481c7a1f49',
    },
  ])('level $level run with seed "$seed"', (golden) => {
    const result = simulateStages({
      character: createCharacter(golden.level, rules),
      seed: golden.seed,
      rulesVersion: GAME_RULES_VERSION,
      maxStages: 10_000,
    });
    expect(result.highestStageCleared).toBe(golden.highest);
    expect(result.totalRewards.gold.toString()).toBe(golden.gold);
    expect(result.totalRewards.experience.toString()).toBe(golden.experience);
    expect(fingerprint(result)).toBe(golden.fingerprint);
  });
});
