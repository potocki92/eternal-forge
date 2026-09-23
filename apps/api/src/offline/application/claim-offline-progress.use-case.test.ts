import { randomUUID } from 'node:crypto';
import {
  GAME_RULES_VERSION,
  HugeNumber,
  StageNumber,
  getGameRules,
  resolveOfflineProgress,
  type StageMode,
  type StageProgress,
} from '@eternal-forge/game-core';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualClock, sequentialSeeds } from '../../../test/support/create-test-app.js';
import { InMemoryGameRepository } from '../../../test/support/in-memory-game.repository.js';
import type { AuthenticatedIdentity } from '../../auth/application/authenticated-identity.js';
import { RunCombatUseCase } from '../../combat/application/run-combat.use-case.js';
import { NEW_CHARACTER_STATE, type Character } from '../../player/domain/player.js';
import { verifyOfflineRun } from '../domain/offline-run.js';
import {
  CLAIM_OFFLINE_MAX_ATTEMPTS,
  ClaimOfflineProgressUseCase,
  type ClaimOfflineProgressResult,
} from './claim-offline-progress.use-case.js';

const rules = getGameRules(GAME_RULES_VERSION);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

let repository: InMemoryGameRepository;
let clock: ManualClock;
let useCase: ClaimOfflineProgressUseCase;
let identity: AuthenticatedIdentity;
let character: Character;

beforeEach(async () => {
  clock = new ManualClock();
  repository = new InMemoryGameRepository(() => clock.now());
  useCase = new ClaimOfflineProgressUseCase(repository, sequentialSeeds('next-offline'), clock);
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
  character = outcome.player.mainCharacter;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function stages(current: bigint, reached: bigint, cleared: bigint | null): StageProgress {
  return {
    current: StageNumber.of(current),
    highestReached: StageNumber.of(reached),
    highestCleared: cleared === null ? null : StageNumber.of(cleared),
  };
}

/** Puts the hero on `progress`, idle since now, then lets `awayMs` pass. */
function awayFor(
  awayMs: number,
  progress: StageProgress = stages(10n, 10n, 9n),
  mode: StageMode = 'PROGRESS',
  level = 10,
): void {
  repository.updateCharacter(character.id, {
    level,
    stages: progress,
    stageMode: mode,
    nextCombatAt: clock.now(),
  });
  clock.advance(awayMs);
}

function claim(key: string = randomUUID(), who: AuthenticatedIdentity = identity) {
  return useCase.execute(who, { characterId: character.id, idempotencyKey: key });
}

function answered(result: ClaimOfflineProgressResult) {
  if (result.kind === 'not-found' || result.kind === 'conflict') {
    throw new Error(`Expected an answer, got ${result.kind}`);
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

describe('ClaimOfflineProgressUseCase — a claim', () => {
  it('collects exactly what Game Core resolves for the server-measured idle time', async () => {
    awayFor(3 * HOUR);
    const idleSince = new Date(clock.now().getTime() - 3 * HOUR);
    const seed = repository.offlineSeedOf(character.id);
    const before = await current();

    const result = answered(await claim());
    const expected = resolveOfflineProgress({
      progress: before,
      elapsedMs: 3 * HOUR,
      seed,
      rulesVersion: GAME_RULES_VERSION,
    });

    expect(result.kind).toBe('collected');
    expect(result.offline.elapsedMs).toBe(3 * HOUR);
    expect(result.offline.rewardedMs).toBe(3 * HOUR);
    expect(result.offline.capReached).toBe(false);
    expect(result.offline.idleSince).toEqual(idleSince);
    expect(result.offline.fights).toBe(expected.fights);
    expect(result.offline.wins).toBe(expected.wins);
    expect(result.offline.rewards.gold.eq(expected.rewards.gold)).toBe(true);
    expect(result.offline.target?.number.toBigInt()).toBe(9n);

    const after = await current();
    expect(after.level).toBe(expected.after.level);
    expect(after.gold.eq(expected.after.gold)).toBe(true);
    expect(after.experience.eq(expected.after.experience)).toBe(true);
    expect(result.character).toEqual(after);
  });

  it('moves the processed boundary to the end of the last fight, never past now', async () => {
    awayFor(2 * HOUR + 12_345);
    const result = answered(await claim());
    const after = await current();

    expect(after.nextCombatAt).toEqual(result.offline.processedUntil);
    expect(after.nextCombatAt.getTime()).toBeLessThanOrEqual(clock.now().getTime());
    // The remainder is shorter than a fight and is kept for the next claim.
    expect(clock.now().getTime() - after.nextCombatAt.getTime()).toBeLessThan(
      rules.combat.timeLimitMs,
    );
  });

  it('never moves the stage, the mode or a record', async () => {
    awayFor(8 * HOUR, stages(10n, 10n, 9n), 'PROGRESS', 60);
    await claim();
    const after = await current();
    expect(after.stages).toEqual(stages(10n, 10n, 9n));
    expect(after.stageMode).toBe('PROGRESS');
  });

  it('respects an intentional farm stage', async () => {
    awayFor(HOUR, stages(25n, 41n, 40n), 'FARM', 300);
    const result = answered(await claim());
    expect(result.offline.target?.number.toBigInt()).toBe(25n);
    expect((await current()).stageMode).toBe('FARM');
  });

  it('caps a long absence at 8 hours and forfeits the rest', async () => {
    awayFor(14 * HOUR + 32 * MINUTE);
    const result = answered(await claim());
    expect(result.offline.elapsedMs).toBe(14 * HOUR + 32 * MINUTE);
    expect(result.offline.rewardedMs).toBe(8 * HOUR);
    expect(result.offline.capReached).toBe(true);
    expect(result.offline.capMs).toBe(8 * HOUR);
    const after = await current();
    // Nothing before `now − cap` can be claimed later.
    expect(after.nextCombatAt.getTime()).toBeGreaterThan(clock.now().getTime() - 8 * HOUR);
  });

  it('rotates the offline seed on commit and records the seed it used', async () => {
    awayFor(HOUR);
    const used = repository.offlineSeedOf(character.id);
    await claim();
    const [run] = repository.offlineRunsOf(character.id);
    expect(run?.seed).toBe(used);
    expect(repository.offlineSeedOf(character.id)).toBe('next-offline-1');
    expect(run !== undefined && verifyOfflineRun(run)).toBe(true);
  });
});

describe('ClaimOfflineProgressUseCase — nothing to collect', () => {
  it.each([0, 1_000, MINUTE - 1])('writes nothing after %i ms', async (awayMs) => {
    awayFor(awayMs);
    const before = await current();
    const seed = repository.offlineSeedOf(character.id);
    const result = answered(await claim());

    expect(result.kind).toBe('nothing');
    expect(result.offline.idleReason).toBe('TOO_SOON');
    expect(result.offline.runId).toBeNull();
    expect(result.offline.processedUntil).toEqual(before.nextCombatAt);
    expect(await current()).toEqual(before);
    expect(repository.offlineSeedOf(character.id)).toBe(seed);
    expect(repository.offlineRunsOf(character.id)).toHaveLength(0);
  });

  it('writes nothing for a hero that never cleared a stage', async () => {
    awayFor(20 * HOUR, stages(1n, 1n, null));
    const before = await current();
    const result = answered(await claim());
    expect(result.offline.idleReason).toBe('NO_CLEARED_STAGE');
    expect(await current()).toEqual(before);
  });

  it('reports no idle time for a hero still fighting (a future boundary)', async () => {
    awayFor(0);
    repository.updateCharacter(character.id, {
      nextCombatAt: new Date(clock.now().getTime() + 5_000),
    });
    const result = answered(await claim());
    expect(result.offline.elapsedMs).toBe(0);
    expect(result.offline.rewardedMs).toBe(0);
    expect(repository.offlineRunsOf(character.id)).toHaveLength(0);
  });

  it('never lets a zero result re-roll the claim: the same seed stays until one commits', async () => {
    awayFor(MINUTE - 1);
    const seed = repository.offlineSeedOf(character.id);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await claim();
    }
    expect(repository.offlineSeedOf(character.id)).toBe(seed);
  });
});

describe('ClaimOfflineProgressUseCase — idempotency and concurrency', () => {
  it('replays a repeated key from the stored summary without simulating again', async () => {
    awayFor(HOUR);
    const key = randomUUID();
    const first = answered(await claim(key));
    clock.advance(3 * HOUR);
    const again = answered(await claim(key));

    expect(again.kind).toBe('replayed');
    expect(again.offline).toEqual(first.offline);
    expect(repository.offlineRunsOf(character.id)).toHaveLength(1);
    expect((await current()).gold.eq(first.character.gold)).toBe(true);
  });

  it('finds nothing for a second claim with a new key right after the first', async () => {
    awayFor(8 * HOUR);
    await claim();
    const second = answered(await claim());
    expect(second.kind).toBe('nothing');
    expect(repository.offlineRunsOf(character.id)).toHaveLength(1);
  });

  it('replays the winner when a retry of the same key races its original', async () => {
    awayFor(HOUR);
    const key = randomUUID();
    let raced: Promise<ClaimOfflineProgressResult> | undefined;
    repository.beforeCommitClaim = () => {
      repository.beforeCommitClaim = undefined;
      raced = claim(key);
      return raced.then(() => undefined);
    };
    const first = answered(await claim(key));
    const second = answered(await (raced ?? Promise.reject(new Error('no race'))));

    expect([first.kind, second.kind].sort()).toEqual(['collected', 'replayed']);
    expect(first.offline).toEqual(second.offline);
    expect(repository.offlineRunsOf(character.id)).toHaveLength(1);
  });

  it('collects nothing more when another device claimed first', async () => {
    awayFor(HOUR);
    repository.beforeCommitClaim = async () => {
      repository.beforeCommitClaim = undefined;
      await claim();
    };
    const result = answered(await claim());
    expect(result.kind).toBe('nothing');
    expect(repository.offlineRunsOf(character.id)).toHaveLength(1);
  });

  it('re-resolves against a combat that committed first: the fight ends the idle time', async () => {
    awayFor(HOUR);
    const combat = new RunCombatUseCase(repository, sequentialSeeds('combat'), clock);
    repository.beforeCommitClaim = async () => {
      repository.beforeCommitClaim = undefined;
      await combat.execute(identity, { characterId: character.id, idempotencyKey: randomUUID() });
    };
    const result = answered(await claim());

    // The online fight moved the boundary past now: the hour is gone, once.
    expect(result.kind).toBe('nothing');
    expect(repository.runsOf(character.id)).toHaveLength(1);
    expect(repository.offlineRunsOf(character.id)).toHaveLength(0);
  });

  it('gives up after a bounded number of conflicts, writing nothing', async () => {
    awayFor(HOUR);
    const commit = vi.spyOn(repository, 'commitClaim').mockResolvedValue({ kind: 'conflict' });
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const result = await claim();
    expect(result.kind).toBe('conflict');
    expect(commit).toHaveBeenCalledTimes(CLAIM_OFFLINE_MAX_ATTEMPTS);
    expect(repository.offlineRunsOf(character.id)).toHaveLength(0);
  });

  it('does not find another player’s character', async () => {
    awayFor(HOUR);
    const stranger = { authUserId: randomUUID(), sessionId: undefined };
    expect((await claim(randomUUID(), stranger)).kind).toBe('not-found');
    expect(repository.offlineRunsOf(character.id)).toHaveLength(0);
  });
});

describe('ClaimOfflineProgressUseCase — structured events', () => {
  it('logs processed and capped with counts, never the seed', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    awayFor(9 * HOUR);
    const seed = repository.offlineSeedOf(character.id);
    await claim();

    const events = log.mock.calls.map(([message]) => message as Record<string, unknown>);
    expect(events.map((event) => event['event'])).toEqual(['offline.processed', 'offline.capped']);
    expect(events[0]).toMatchObject({ characterId: character.id, capReached: true });
    expect(JSON.stringify(events)).not.toContain(seed);
  });

  it('logs a replay and a no-op', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const debug = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    awayFor(HOUR);
    const key = randomUUID();
    await claim(key);
    await claim(key);
    await claim();

    expect(log.mock.calls.map(([message]) => (message as { event: string }).event)).toContain(
      'offline.replayed',
    );
    expect(debug.mock.calls.map(([message]) => (message as { event: string }).event)).toEqual([
      'offline.noop',
    ]);
  });
});

describe('ClaimOfflineProgressUseCase — numbers', () => {
  it('keeps a farm stage beyond 2^53 exact and refuses it as not playable', async () => {
    const beyond = 9_007_199_254_740_993n;
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    awayFor(HOUR, stages(beyond, beyond + 1n, beyond), 'FARM');
    const result = answered(await claim());
    expect(result.offline.idleReason).toBe('STAGE_NOT_PLAYABLE');
    expect((await current()).stages.current.toBigInt()).toBe(beyond);
  });

  it('adds offline gold to an enormous balance exactly as Game Core does', async () => {
    repository.updateCharacter(character.id, { gold: HugeNumber.fromDecimal('1e60') });
    awayFor(HOUR, stages(1_001n, 1_001n, 1_000n), 'PROGRESS', 2_000);
    const result = answered(await claim());
    expect(result.character.gold.gt(HugeNumber.fromDecimal('1e60'))).toBe(true);
    expect(HugeNumber.parse(result.character.gold.toString()).eq(result.character.gold)).toBe(true);
  });
});
