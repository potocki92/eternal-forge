import { randomUUID } from 'node:crypto';
import type {
  CombatRepository,
  CombatTarget,
  CommitCombat,
  CommitCombatResult,
} from '../../src/combat/application/ports/combat-repository.port.js';
import type { CombatRun } from '../../src/combat/domain/combat-run.js';
import type {
  PlayerRepository,
  ProvisionPlayerData,
  ProvisionPlayerOutcome,
} from '../../src/player/application/ports/player-repository.port.js';
import {
  MAIN_CHARACTER_SLOT,
  type Character,
  type Player,
  type Profile,
} from '../../src/player/domain/player.js';

interface StoredCharacter {
  character: Character;
  version: bigint;
}

/**
 * In-memory {@link PlayerRepository} and {@link CombatRepository} over one
 * shared store, with the ports' documented semantics: owner-scoped reads,
 * idempotent provisioning, and a combat commit that is atomic, conditional on
 * the character's version and unique per `(character, idempotency key)`.
 *
 * Used where a test is about the layers above persistence. The PostgreSQL
 * adapters are covered against a real database in `test-integration/`.
 */
export class InMemoryGameRepository implements PlayerRepository, CombatRepository {
  private readonly profiles = new Map<string, Profile>();
  private readonly characters: StoredCharacter[] = [];
  private readonly combatRuns: CombatRun[] = [];

  /**
   * Runs just before a commit is applied. Tests use it to let a "concurrent"
   * request commit first, which PostgreSQL would serialise the same way.
   */
  beforeCommit: (() => Promise<void>) | undefined;

  constructor(private readonly now: () => Date = () => new Date('2026-09-22T10:00:00.000Z')) {}

  // --- PlayerRepository ---------------------------------------------------

  findByAuthUserId(authUserId: string): Promise<Player | null> {
    const profile = this.profiles.get(authUserId);
    const mainCharacter = profile && this.characterIn(profile.id, MAIN_CHARACTER_SLOT);

    return Promise.resolve(
      profile && mainCharacter ? { profile, mainCharacter: mainCharacter.character } : null,
    );
  }

  findOwnedCharacter(authUserId: string, characterId: string): Promise<Character | null> {
    return Promise.resolve(this.owned(authUserId, characterId)?.character ?? null);
  }

  provision(data: ProvisionPlayerData): Promise<ProvisionPlayerOutcome> {
    let created = false;
    let profile = this.profiles.get(data.authUserId);

    if (profile === undefined) {
      profile = {
        id: randomUUID(),
        authUserId: data.authUserId,
        displayName: data.displayName,
        createdAt: this.now(),
        updatedAt: this.now(),
      };
      this.profiles.set(data.authUserId, profile);
      created = true;
    }

    let stored = this.characterIn(profile.id, data.characterSlot);
    if (stored === undefined) {
      stored = {
        character: {
          id: randomUUID(),
          profileId: profile.id,
          slot: data.characterSlot,
          name: data.characterName,
          level: data.characterLevel,
          stage: data.characterStage,
          experience: data.characterExperience,
          gold: data.characterGold,
          nextCombatAt: data.characterNextCombatAt,
          createdAt: this.now(),
          updatedAt: this.now(),
        },
        version: 0n,
      };
      this.characters.push(stored);
      created = true;
    }

    return Promise.resolve({ player: { profile, mainCharacter: stored.character }, created });
  }

  // --- CombatRepository ---------------------------------------------------

  loadTarget(
    authUserId: string,
    characterId: string,
    idempotencyKey: string,
  ): Promise<CombatTarget | null> {
    const stored = this.owned(authUserId, characterId);
    if (stored === undefined) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      character: stored.character,
      version: stored.version,
      existingRun: this.runFor(characterId, idempotencyKey) ?? null,
    });
  }

  async commit(command: CommitCombat): Promise<CommitCombatResult> {
    await this.beforeCommit?.();

    const stored = this.owned(command.authUserId, command.characterId);
    if (
      stored?.version !== command.expectedVersion ||
      this.runFor(command.characterId, command.run.idempotencyKey) !== undefined
    ) {
      return { kind: 'conflict' };
    }

    stored.character = {
      ...stored.character,
      ...command.progress,
      nextCombatAt: command.nextCombatAt,
    };
    stored.version += 1n;
    const run: CombatRun = { ...command.run, id: randomUUID() };
    this.combatRuns.push(run);
    return { kind: 'committed', run };
  }

  // --- Test helpers -------------------------------------------------------

  /** Every combat recorded for a character, oldest first. */
  runsOf(characterId: string): readonly CombatRun[] {
    return this.combatRuns.filter((run) => run.characterId === characterId);
  }

  /** Puts a character into a given state, as a fixture would in PostgreSQL. */
  updateCharacter(characterId: string, change: Partial<Character>): void {
    const stored = this.characters.find((entry) => entry.character.id === characterId);
    if (stored === undefined) {
      throw new Error(`No character ${characterId}`);
    }
    stored.character = { ...stored.character, ...change };
    stored.version += 1n;
  }

  private owned(authUserId: string, characterId: string): StoredCharacter | undefined {
    const profile = this.profiles.get(authUserId);
    return this.characters.find(
      (entry) => entry.character.id === characterId && entry.character.profileId === profile?.id,
    );
  }

  private characterIn(profileId: string, slot: number): StoredCharacter | undefined {
    return this.characters.find(
      (entry) => entry.character.profileId === profileId && entry.character.slot === slot,
    );
  }

  private runFor(characterId: string, idempotencyKey: string): CombatRun | undefined {
    return this.combatRuns.find(
      (run) => run.characterId === characterId && run.idempotencyKey === idempotencyKey,
    );
  }
}
