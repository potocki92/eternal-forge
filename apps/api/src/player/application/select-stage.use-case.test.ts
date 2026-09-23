import { randomUUID } from 'node:crypto';
import {
  HugeNumber,
  StageNumber,
  calculateStageRewards,
  getGameRules,
  type StageProgress,
  type StageSelection,
} from '@eternal-forge/game-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { ManualClock, sequentialSeeds } from '../../../test/support/create-test-app.js';
import { InMemoryGameRepository } from '../../../test/support/in-memory-game.repository.js';
import type { AuthenticatedIdentity } from '../../auth/application/authenticated-identity.js';
import {
  RunCombatUseCase,
  type RunCombatResult,
} from '../../combat/application/run-combat.use-case.js';
import { NEW_CHARACTER_STATE, type Character } from '../domain/player.js';
import {
  SELECT_STAGE_MAX_ATTEMPTS,
  SelectStageUseCase,
  type SelectStageResult,
} from './select-stage.use-case.js';

const rules = getGameRules(1);

let repository: InMemoryGameRepository;
let clock: ManualClock;
let selectStage: SelectStageUseCase;
let runCombat: RunCombatUseCase;
let identity: AuthenticatedIdentity;
let characterId: string;

beforeEach(async () => {
  clock = new ManualClock();
  repository = new InMemoryGameRepository(() => clock.now());
  selectStage = new SelectStageUseCase(repository, clock);
  runCombat = new RunCombatUseCase(repository, sequentialSeeds('select'), clock);
  identity = { authUserId: randomUUID(), sessionId: undefined };
  const outcome = await repository.provision({
    authUserId: identity.authUserId,
    displayName: 'Kael',
    characterName: 'Ember',
    characterSlot: 1,
    characterLevel: NEW_CHARACTER_STATE.level,
    characterStages: NEW_CHARACTER_STATE.stages,
    characterStageMode: NEW_CHARACTER_STATE.stageMode,
    characterExperience: NEW_CHARACTER_STATE.experience,
    characterGold: NEW_CHARACTER_STATE.gold,
    characterNextCombatAt: clock.now(),
  });
  characterId = outcome.player.mainCharacter.id;
});

function progress(
  current: bigint | number,
  reached: bigint | number,
  cleared: bigint | number | null,
): StageProgress {
  return {
    current: StageNumber.of(current),
    highestReached: StageNumber.of(reached),
    highestCleared: cleared === null ? null : StageNumber.of(cleared),
  };
}

function farm(stage: bigint | number): StageSelection {
  return { mode: 'FARM', stage: StageNumber.of(stage) };
}

const climb: StageSelection = { mode: 'PROGRESS' };

function select(selection: StageSelection, who: AuthenticatedIdentity = identity) {
  return selectStage.execute(who, { characterId, selection });
}

function selected(result: SelectStageResult) {
  if (result.kind !== 'selected') {
    throw new Error(`Expected a selection, got ${result.kind}`);
  }
  return result;
}

function resolved(result: RunCombatResult) {
  if (result.kind !== 'resolved') {
    throw new Error(`Expected a resolved combat, got ${result.kind}`);
  }
  return result;
}

async function stored(): Promise<Character> {
  const found = await repository.findOwnedCharacter(identity.authUserId, characterId);
  if (found === null) {
    throw new Error('character vanished');
  }
  return found;
}

function view(character: Character): string {
  const { current, highestReached, highestCleared } = character.stages;
  return `${character.stageMode} ${current.toString()} / ${highestReached.toString()} / ${highestCleared?.toString() ?? 'null'}`;
}

async function fight() {
  const result = resolved(
    await runCombat.execute(identity, { characterId, idempotencyKey: randomUUID() }),
  );
  clock.advance(result.combat.attempt.combat.durationMs);
  return result;
}

describe('SelectStageUseCase — selection', () => {
  beforeEach(() => {
    repository.updateCharacter(characterId, { stages: progress(9, 10, 9), level: 30 });
  });

  it('farms an unlocked earlier stage and persists the choice', async () => {
    const result = selected(await select(farm(4)));

    expect(view(result.character)).toBe('FARM 4 / 10 / 9');
    expect(view(await stored())).toBe('FARM 4 / 10 / 9');
    expect(result.progression.stageMode).toBe('FARM');
    expect(result.progression.encounter?.stage.number.toString()).toBe('4');
    expect(result.serverTime).toEqual(clock.now());
  });

  it('switches FARM → PROGRESS: back to the frontier', async () => {
    await select(farm(4));

    const result = selected(await select(climb));

    expect(view(result.character)).toBe('PROGRESS 10 / 10 / 9');
    expect(view(await stored())).toBe('PROGRESS 10 / 10 / 9');
    expect(result.progression.encounter?.stage.kind).toBe('BOSS');
  });

  it('switches PROGRESS → FARM on the stage the hero stands on', async () => {
    const result = selected(await select(farm(9)));

    expect(view(result.character)).toBe('FARM 9 / 10 / 9');
  });

  it('may farm the frontier itself', async () => {
    expect(view(selected(await select(farm(10))).character)).toBe('FARM 10 / 10 / 9');
  });

  it.each([11n, 999_999n, 9_223_372_036_854_775_807n])(
    'refuses locked stage %s and writes nothing',
    async (stage) => {
      const before = await stored();

      const result = await select(farm(stage));

      expect(result).toEqual({ kind: 'stage-locked', highestStageReached: StageNumber.of(10) });
      expect(await stored()).toBe(before);
    },
  );

  it('never moves a record, whatever is selected', async () => {
    for (const selection of [farm(1), farm(10), climb, farm(5), climb]) {
      const { character } = selected(await select(selection));
      expect(character.stages.highestReached.toString()).toBe('10');
      expect(character.stages.highestCleared?.toString()).toBe('9');
    }
  });

  it('a repeated selection changes nothing and writes nothing', async () => {
    await select(farm(4));
    const written = await stored();

    const again = selected(await select(farm(4)));

    expect(again.character).toBe(written);
    expect(await stored()).toBe(written);
  });

  it('touches no gold, experience, level or pacing gate', async () => {
    const before = await stored();

    const { character } = selected(await select(farm(2)));

    expect(character.gold).toBe(before.gold);
    expect(character.experience).toBe(before.experience);
    expect(character.level).toBe(before.level);
    expect(character.nextCombatAt).toBe(before.nextCombatAt);
  });
});

describe('SelectStageUseCase — huge stages', () => {
  it('selects 9007199254740993 exactly, and refuses one past the frontier', async () => {
    repository.updateCharacter(characterId, {
      stages: progress(1n, 9_007_199_254_740_995n, 9_007_199_254_740_994n),
    });

    const result = selected(await select(farm(9_007_199_254_740_993n)));
    expect(result.character.stages.current.toString()).toBe('9007199254740993');
    expect((await stored()).stages.current.toBigInt()).toBe(9_007_199_254_740_993n);

    // Equal to the frontier as a double; locked as an exact integer.
    expect((await select(farm(9_007_199_254_740_996n))).kind).toBe('stage-locked');
  });
});

describe('SelectStageUseCase — ownership', () => {
  it('cannot select for someone else’s character', async () => {
    const stranger = { authUserId: randomUUID(), sessionId: undefined };
    const before = await stored();

    expect(await select(farm(1), stranger)).toEqual({ kind: 'not-found' });
    expect(await stored()).toBe(before);
  });

  it('reports an unknown character as not found', async () => {
    const result = await selectStage.execute(identity, {
      characterId: randomUUID(),
      selection: climb,
    });
    expect(result).toEqual({ kind: 'not-found' });
  });
});

describe('SelectStageUseCase — concurrency', () => {
  it('re-validates and retries when a combat commits in between', async () => {
    repository.updateCharacter(characterId, { stages: progress(9, 9, 8), level: 60 });
    repository.beforeSaveSelection = async () => {
      repository.beforeSaveSelection = undefined;
      await fight(); // 9 / 9 / 8 → 10 / 10 / 9, committed first
    };

    const result = selected(await select(farm(4)));

    expect(view(result.character)).toBe('FARM 4 / 10 / 9');
    expect(view(await stored())).toBe('FARM 4 / 10 / 9');
  });

  it('gives up after a bounded number of attempts and writes nothing', async () => {
    let interruptions = 0;
    repository.beforeSaveSelection = () => {
      interruptions += 1;
      repository.updateCharacter(characterId, {}); // moves the version on
      return Promise.resolve();
    };

    expect(await select(farm(1))).toEqual({ kind: 'conflict' });
    expect(interruptions).toBe(SELECT_STAGE_MAX_ATTEMPTS);
    expect(view(await stored())).toBe('PROGRESS 1 / 1 / null');
  });

  it('a combat resolved before a selection cannot commit after it', async () => {
    repository.updateCharacter(characterId, { stages: progress(9, 10, 9), level: 60 });
    repository.beforeCommit = async () => {
      repository.beforeCommit = undefined;
      selected(await select(farm(3)));
    };

    const lost = await runCombat.execute(identity, { characterId, idempotencyKey: randomUUID() });

    // The combat was simulated for stage 9 in PROGRESS mode; the selection
    // won the race, so the stale combat wrote nothing.
    expect(lost.kind).toBe('not-ready');
    expect(repository.runsOf(characterId)).toHaveLength(0);
    expect(view(await stored())).toBe('FARM 3 / 10 / 9');
  });
});

describe('RunCombatUseCase — farming (ADR-021)', () => {
  beforeEach(() => {
    // A strong hero that reached the stage-100 boss but never beat it.
    repository.updateCharacter(characterId, {
      stages: progress(100, 100, 99),
      level: 400,
      gold: HugeNumber.fromNumber(10),
    });
  });

  it('a farm victory pays the normal rewards and stays on the farmed stage', async () => {
    await select(farm(99));

    const { combat } = await fight();

    expect(combat.attempt.stage.number.toString()).toBe('99');
    expect(combat.attempt.combat.outcome).toBe('WIN');
    expect(combat.attempt.rewards).toEqual(
      calculateStageRewards(combat.attempt.stage, rules.rewards),
    );
    expect(combat.run.stageMode).toBe('FARM');
    expect(view(await stored())).toBe('FARM 99 / 100 / 99');
    expect(
      (await stored()).gold.eq(HugeNumber.fromNumber(10).add(combat.attempt.rewards.gold)),
    ).toBe(true);
  });

  it('farming stage 99 many times never clears the stage-100 boss', async () => {
    await select(farm(99));

    for (let round = 0; round < 25; round += 1) {
      await fight();
    }

    expect(view(await stored())).toBe('FARM 99 / 100 / 99');
    expect(repository.runsOf(characterId)).toHaveLength(25);
    expect(repository.runsOf(characterId).every((run) => run.outcome === 'WIN')).toBe(true);
  });

  it('progress mode continues the existing progression after farming', async () => {
    await select(farm(99));
    await fight();

    await select(climb);
    const { combat } = await fight();

    expect(combat.attempt.stage.number.toString()).toBe('100');
    expect(combat.attempt.stage.kind).toBe('BOSS');
    expect(combat.run.stageMode).toBe('PROGRESS');
    expect(view(await stored())).toBe('PROGRESS 101 / 101 / 100');
  });

  it('a farm defeat stays on the stage and grants nothing', async () => {
    repository.updateCharacter(characterId, { stages: progress(10, 10, 9), level: 1 });
    await select(farm(10));

    const { combat } = await fight();

    expect(combat.attempt.combat.outcome).toBe('LOSS');
    expect(combat.run.rewards.gold.isZero()).toBe(true);
    expect(view(await stored())).toBe('FARM 10 / 10 / 9');
  });

  it('replays a farm combat with the mode it was fought in, after the mode changed', async () => {
    await select(farm(99));
    const key = randomUUID();
    const first = resolved(await runCombat.execute(identity, { characterId, idempotencyKey: key }));
    await select(climb);

    const replay = resolved(
      await runCombat.execute(identity, { characterId, idempotencyKey: key }),
    );

    expect(replay.replayed).toBe(true);
    expect(replay.combat.run.id).toBe(first.combat.run.id);
    expect(replay.combat.attempt.after.stages.current.toString()).toBe('99');
    // Regression: the replayed character and progression describe the state
    // the combat left, mode included — never the recorded stage with the
    // current mode.
    expect(replay.combat.character.stageMode).toBe('FARM');
    expect(replay.combat.progression.stageMode).toBe('FARM');
    expect(replay.combat.progression.stages.current.toString()).toBe('99');
    expect(JSON.stringify(replay.combat.attempt)).toBe(JSON.stringify(first.combat.attempt));
  });
});
