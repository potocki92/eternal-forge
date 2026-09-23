import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  GAME_RULES_VERSION,
  HugeNumber,
  StageNumber,
  createCharacter,
  getGameRules,
  resolveStageAttempt,
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
 *
 * Stage numbers are hashed as JSON numbers, the form they had when these
 * fingerprints were recorded. `StageNumber` (ADR-018) changed only their
 * representation, and this projection proves it changed no outcome. Every
 * stage here is far below 2^53, so the projection is exact.
 */

const rules = getGameRules(GAME_RULES_VERSION);

function fingerprint(value: unknown): string {
  const json = JSON.stringify(value, function (this: Record<string, unknown>, key, field) {
    const raw = this[key];
    return raw instanceof StageNumber ? Number(raw.toBigInt()) : (field as unknown);
  });
  return createHash('sha256').update(json).digest('hex');
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
      (entry) => `Stage ${entry.stage.number.toString()} — ${entry.outcome}`,
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
      highest: '29',
      gold: '1.288e3',
      experience: '5.33e2',
      fingerprint: 'd12e6dd36ebb5ff77bca25dcd8660585b22fc1e3fa983f134f1d4a906fccffb3',
    },
    {
      level: 500,
      seed: 'golden-deep',
      highest: '429',
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
    expect(result.highestStageCleared?.toString()).toBe(golden.highest);
    expect(result.totalRewards.gold.toString()).toBe(golden.gold);
    expect(result.totalRewards.experience.toString()).toBe(golden.experience);
    expect(fingerprint(result)).toBe(golden.fingerprint);
  });

  // Recorded in Phase 3 (ADR-019), when stage attempts were first persisted.
  // They pin the progression rules of RULES_V1 — level-up, defeat fallback,
  // the stage records of ADR-020 — and the whole attempt, not only its combat.
  //
  // `combat` and `rewards` fingerprints were taken from the build *before*
  // ADR-020 replaced the single stage with StageProgress: they prove that
  // change altered no outcome. `fingerprint` covers the whole result in its
  // ADR-020 shape; it was re-recorded then, before any result was persisted.
  it.each([
    {
      name: 'a first-stage win',
      progress: { level: 1, experience: '8', gold: '0', stage: 1n },
      seed: 'golden-attempt-win',
      after: { level: 2, experience: '1e0', gold: '5e0', stages: '2 / 2 / 1' },
      combat: '0d59b7a83cc458e03d9155496990c1526ca3b3f9fd443e7c5bd78d4ad3aaf05f',
      rewards: '734d63eb255403f460597a3f90d45f3c936ad521113d9b3eeb2a724e3c7f7583',
      fingerprint: 'fe7a213eec0198f631cf5f68e19a53fedefe9c6c743a8cfae3ed25bf6a348e9f',
    },
    {
      name: 'a boss-wall defeat',
      progress: { level: 4, experience: '3', gold: '41', stage: 10n },
      seed: 'golden-attempt-boss',
      after: { level: 4, experience: '3e0', gold: '4.1e1', stages: '9 / 10 / 9' },
      combat: '47d0a89bfcdf42ee43ec99da0522a03deb7006d6f8dadb2e960b309233c206bb',
      rewards: '9222fba6c915c38ac92410540a0a42cd53a993fc7c74a017467e38f518137a01',
      fingerprint: '3c5c1c38d1bf55a31d463c3390d239345411a2b83e81bdbc65214ef249eb164b',
    },
  ])('stage attempt: $name', (golden) => {
    // A hero pushing its record: every stage before this one cleared.
    const stage = StageNumber.of(golden.progress.stage);
    const result = resolveStageAttempt({
      progress: {
        level: golden.progress.level,
        experience: HugeNumber.fromDecimal(golden.progress.experience),
        gold: HugeNumber.fromDecimal(golden.progress.gold),
        stages: {
          current: stage,
          highestReached: stage,
          highestCleared: stage.equals(StageNumber.FIRST) ? null : stage.stepBack(1),
        },
      },
      // The Phase 3 mode. ADR-021 made the mode an explicit input; these
      // fingerprints are unchanged, which proves PROGRESS behaves as before.
      mode: 'PROGRESS',
      seed: golden.seed,
      rulesVersion: GAME_RULES_VERSION,
    });
    const { stages } = result.after;
    expect({
      level: result.after.level,
      experience: result.after.experience.toString(),
      gold: result.after.gold.toString(),
      stages: `${stages.current.toString()} / ${stages.highestReached.toString()} / ${stages.highestCleared?.toString() ?? 'null'}`,
    }).toEqual(golden.after);
    expect(fingerprint(result.combat)).toBe(golden.combat);
    expect(fingerprint(result.rewards)).toBe(golden.rewards);
    expect(fingerprint(result)).toBe(golden.fingerprint);
  });
});

// Recorded with ADR-021, when FARM mode was introduced. Farming stage 9 below
// the unbeaten stage-10 boss: the combat and rewards are those of any stage-9
// win, and the hero stays on stage 9 with its records unchanged.
describe(`golden farming — rules v${GAME_RULES_VERSION}`, () => {
  it('stage attempt: a farm win below the boss wall', () => {
    const result = resolveStageAttempt({
      progress: {
        level: 4,
        experience: HugeNumber.fromDecimal('3'),
        gold: HugeNumber.fromDecimal('41'),
        stages: {
          current: StageNumber.of(9),
          highestReached: StageNumber.of(10),
          highestCleared: StageNumber.of(9),
        },
      },
      mode: 'FARM',
      seed: 'golden-attempt-farm',
      rulesVersion: GAME_RULES_VERSION,
    });
    const { stages } = result.after;
    const climbing = resolveStageAttempt({ ...input(result), mode: 'PROGRESS' });

    // Same fight, same pay: only where the hero goes next differs.
    expect(fingerprint(climbing.combat)).toBe(fingerprint(result.combat));
    expect(fingerprint(climbing.rewards)).toBe(fingerprint(result.rewards));
    expect({
      outcome: result.combat.outcome,
      level: result.after.level,
      experience: result.after.experience.toString(),
      gold: result.after.gold.toString(),
      stages: `${stages.current.toString()} / ${stages.highestReached.toString()} / ${stages.highestCleared?.toString() ?? 'null'}`,
    }).toEqual({
      outcome: 'WIN',
      level: 4,
      experience: '9e0',
      gold: '5.3e1',
      stages: '9 / 10 / 9',
    });
    expect(fingerprint(result.combat)).toBe(
      '9e85032f4b32b72b9054346c40958d54c4ecf18a3874bcfb447938a7fdd4b3f9',
    );
    expect(fingerprint(result.rewards)).toBe(
      '7bd8e4d625948511af93e0d1302c26ec82469ee9d8ebaa1ebc44d598e9bbe5aa',
    );
    expect(fingerprint(result)).toBe(
      'f03dd0c8e71c218a401ecd0035b5707c7a0192a412bbc5c081f91ec8b3f91ac3',
    );
  });
});

function input(result: ReturnType<typeof resolveStageAttempt>) {
  return { progress: result.before, seed: result.seed, rulesVersion: result.rulesVersion };
}
