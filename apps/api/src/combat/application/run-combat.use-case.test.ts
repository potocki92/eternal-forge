import { randomUUID } from 'node:crypto';
import {
  HugeNumber,
  StageNumber,
  calculateStageRewards,
  getGameRules,
  resolveStageAttempt,
} from '@eternal-forge/game-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { ManualClock, sequentialSeeds } from '../../../test/support/create-test-app.js';
import { InMemoryGameRepository } from '../../../test/support/in-memory-game.repository.js';
import type { AuthenticatedIdentity } from '../../auth/application/authenticated-identity.js';
import { NEW_CHARACTER_STATE, type Character } from '../../player/domain/player.js';
import {
  CombatReplayMismatchError,
  RunCombatUseCase,
  type RunCombatResult,
} from './run-combat.use-case.js';

const rules = getGameRules(1);

let repository: InMemoryGameRepository;
let clock: ManualClock;
let useCase: RunCombatUseCase;
let identity: AuthenticatedIdentity;
let character: Character;

beforeEach(async () => {
  repository = new InMemoryGameRepository(() => clock.now());
  clock = new ManualClock();
  useCase = new RunCombatUseCase(repository, sequentialSeeds('unit'), clock);
  identity = { authUserId: randomUUID(), sessionId: undefined };
  const outcome = await repository.provision({
    authUserId: identity.authUserId,
    displayName: 'Kael',
    characterName: 'Ember',
    characterSlot: 1,
    characterLevel: NEW_CHARACTER_STATE.level,
    characterStage: NEW_CHARACTER_STATE.stage,
    characterExperience: NEW_CHARACTER_STATE.experience,
    characterGold: NEW_CHARACTER_STATE.gold,
    characterNextCombatAt: clock.now(),
  });
  character = outcome.player.mainCharacter;
});

function fight(key: string = randomUUID(), who: AuthenticatedIdentity = identity) {
  return useCase.execute(who, { characterId: character.id, idempotencyKey: key });
}

function resolved(result: RunCombatResult) {
  if (result.kind !== 'resolved') {
    throw new Error(`Expected a resolved combat, got ${result.kind}`);
  }
  return result;
}

async function current(): Promise<Character> {
  const found = await repository.findOwnedCharacter(identity.authUserId, character.id);
  if (found === null) {
    throw new Error('character vanished');
  }
  return found;
}

describe('RunCombatUseCase — victory', () => {
  it('grants the stage rewards, advances one stage and records the combat', async () => {
    const result = resolved(await fight());
    const { attempt, run } = result.combat;
    const expected = calculateStageRewards(attempt.stage, rules.rewards);

    expect(result.replayed).toBe(false);
    expect(attempt.combat.outcome).toBe('WIN');
    expect(attempt.rewards).toEqual(expected);

    const after = await current();
    expect(after.stage.toString()).toBe('2');
    expect(after.gold.eq(expected.gold)).toBe(true);
    expect(after.experience.eq(expected.experience)).toBe(true);
    expect(result.combat.character).toEqual({ ...after, updatedAt: character.updatedAt });

    expect(repository.runsOf(character.id)).toEqual([run]);
    expect(run).toMatchObject({ outcome: 'WIN', rulesVersion: 1, seed: 'unit-1' });
    expect(run.before.stage.toString()).toBe('1');
  });

  it('occupies the hero for exactly the combat’s duration', async () => {
    const result = resolved(await fight());
    const expected = new Date(clock.now().getTime() + result.combat.attempt.combat.durationMs);

    expect((await current()).nextCombatAt).toEqual(expected);
    expect(result.combat.progression.nextCombatAt).toEqual(expected);
  });

  it('levels up through the Game Core rule', async () => {
    repository.updateCharacter(character.id, { experience: HugeNumber.fromNumber(8) });

    const result = resolved(await fight());

    expect(result.combat.attempt.levelsGained).toBe(1);
    expect((await current()).level).toBe(2);
    expect(result.combat.after.experienceToNextLevel.toString()).toBe('1.1e1');
  });
});

describe('RunCombatUseCase — defeat', () => {
  beforeEach(() => {
    repository.updateCharacter(character.id, {
      stage: StageNumber.of(10),
      gold: HugeNumber.fromNumber(41),
      experience: HugeNumber.fromNumber(3),
    });
  });

  it('grants nothing and falls back one stage', async () => {
    const result = resolved(await fight());

    expect(result.combat.attempt.combat.outcome).toBe('LOSS');
    expect(result.combat.run.rewards.gold.isZero()).toBe(true);
    expect(result.combat.run.rewards.experience.isZero()).toBe(true);

    const after = await current();
    expect(after.stage.toString()).toBe('9');
    expect(after.gold.eq(HugeNumber.fromNumber(41))).toBe(true);
    expect(after.experience.eq(HugeNumber.fromNumber(3))).toBe(true);
    expect(after.level).toBe(1);
  });

  it('fights the boss the rule set places on stage 10', async () => {
    const result = resolved(await fight());

    expect(result.combat.attempt.stage.kind).toBe('BOSS');
    expect(result.combat.attempt.enemy.archetypeId).toBe(rules.stages.bossArchetype.id);
  });
});

describe('RunCombatUseCase — pacing', () => {
  it('refuses a second combat while the first is still being fought', async () => {
    const first = resolved(await fight());

    const early = await fight();

    expect(early).toEqual({
      kind: 'not-ready',
      nextCombatAt: first.combat.progression.nextCombatAt,
      serverTime: clock.now(),
    });
    expect(repository.runsOf(character.id)).toHaveLength(1);
  });

  it('accepts the next combat once the server clock reaches nextCombatAt', async () => {
    const first = resolved(await fight());
    clock.advance(first.combat.attempt.combat.durationMs);

    const second = resolved(await fight());

    expect(second.combat.attempt.stage.number.toString()).toBe('2');
    expect(repository.runsOf(character.id)).toHaveLength(2);
  });
});

describe('RunCombatUseCase — idempotency', () => {
  it('replays the same key: same combat, rewards applied once', async () => {
    const key = randomUUID();
    const first = resolved(await fight(key));
    const goldAfterFirst = (await current()).gold;

    const second = resolved(await fight(key));

    expect(second.replayed).toBe(true);
    expect(second.combat.run).toEqual(first.combat.run);
    expect(JSON.stringify(second.combat.attempt)).toBe(JSON.stringify(first.combat.attempt));
    expect(second.combat.after).toEqual(first.combat.after);
    expect(repository.runsOf(character.id)).toHaveLength(1);
    expect((await current()).gold.eq(goldAfterFirst)).toBe(true);
  });

  it('replays an old key even after later combats, without touching current state', async () => {
    const key = randomUUID();
    const first = resolved(await fight(key));
    clock.advance(60_000);
    resolved(await fight());
    const before = await current();

    const replay = resolved(await fight(key));

    expect(replay.combat.run.id).toBe(first.combat.run.id);
    expect(await current()).toEqual(before);
  });

  it('replays even while the character is still busy (a retried lost response)', async () => {
    const key = randomUUID();
    resolved(await fight(key));

    expect((await fight(key)).kind).toBe('resolved');
  });
});

describe('RunCombatUseCase — concurrency', () => {
  it('replays the winner when a retry of the same request commits first', async () => {
    const key = randomUUID();
    let winner: RunCombatResult | undefined;
    repository.beforeCommit = async () => {
      repository.beforeCommit = undefined;
      winner = await fight(key);
    };

    const loser = resolved(await fight(key));

    expect(loser.replayed).toBe(true);
    expect(loser.combat.run.id).toBe(resolved(winner ?? { kind: 'not-found' }).combat.run.id);
    expect(repository.runsOf(character.id)).toHaveLength(1);
  });

  it('refuses a different request that lost the race', async () => {
    repository.beforeCommit = async () => {
      repository.beforeCommit = undefined;
      await fight();
    };

    const loser = await fight();

    expect(loser.kind).toBe('not-ready');
    expect(repository.runsOf(character.id)).toHaveLength(1);
    expect((await current()).stage.toString()).toBe('2');
  });
});

describe('RunCombatUseCase — ownership and authority', () => {
  it('cannot fight with someone else’s character', async () => {
    const stranger = { authUserId: randomUUID(), sessionId: undefined };

    expect(await fight(randomUUID(), stranger)).toEqual({ kind: 'not-found' });
    expect(repository.runsOf(character.id)).toHaveLength(0);
  });

  it('reports an unknown character as not found', async () => {
    const result = await useCase.execute(identity, {
      characterId: randomUUID(),
      idempotencyKey: randomUUID(),
    });

    expect(result).toEqual({ kind: 'not-found' });
  });

  it('draws the seed from the server’s seed source, one per combat', async () => {
    const first = resolved(await fight());
    clock.advance(60_000);
    const second = resolved(await fight());

    expect([first.combat.run.seed, second.combat.run.seed]).toEqual(['unit-1', 'unit-2']);
  });

  it('matches Game Core exactly: the API adds no rule of its own', async () => {
    const result = resolved(await fight());
    const expected = resolveStageAttempt({
      progress: {
        level: 1,
        experience: HugeNumber.ZERO,
        gold: HugeNumber.ZERO,
        stage: StageNumber.FIRST,
      },
      seed: 'unit-1',
      rulesVersion: 1,
    });

    expect(result.combat.attempt).toEqual(expected);
  });
});

describe('RunCombatUseCase — replay integrity', () => {
  it('fails loudly instead of serving a result that differs from the record', async () => {
    const key = randomUUID();
    const first = resolved(await fight(key));
    // Simulates a determinism defect: the stored summary no longer matches.
    Object.assign(first.combat.run, { durationMs: first.combat.run.durationMs + 1 });

    await expect(fight(key)).rejects.toBeInstanceOf(CombatReplayMismatchError);
  });
});
