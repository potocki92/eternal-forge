import { randomUUID } from 'node:crypto';
import {
  SKILL_CATALOG,
  SkillDefinitionId,
  SkillLevel,
  createCharacterSkills,
} from '@eternal-forge/game-core';
import type {
  ReplaceSkillLoadoutCommand,
  SkillRepository,
  TrustedSkillGrant,
} from '../../src/skills/application/ports/skill-repository.port.js';
import type { SkillState } from '../../src/skills/domain/skill-state.js';

interface StoredSkills {
  readonly authUserId: string;
  version: bigint;
  /** Raw persisted rows: skill ID → level, so tests can store corrupt state. */
  readonly owned: Map<string, number>;
  /** Raw persisted loadout in position order. */
  loadout: string[];
}

/**
 * In-memory {@link SkillRepository} with the port's documented semantics:
 * owner-scoped reads that validate persisted rows through Game Core (corrupt
 * rows throw), a loadout replacement conditional on the version that writes
 * the whole loadout at once, and trusted grants that advance the version.
 *
 * The PostgreSQL adapter is covered in `test-integration/skills.int.test.ts`.
 */
export class InMemorySkillRepository implements SkillRepository {
  private readonly characters = new Map<string, StoredSkills>();

  /** Runs just before a replacement is applied, so a test can commit a competing write. */
  beforeReplace: (() => Promise<void>) | undefined;

  /** Number of committed loadout replacements. */
  replacements = 0;

  addCharacter(authUserId: string, characterId: string = randomUUID()): string {
    this.characters.set(characterId, { authUserId, version: 0n, owned: new Map(), loadout: [] });
    return characterId;
  }

  /** Stores raw rows without validation, as a corrupted database would hold them. */
  storeRaw(
    characterId: string,
    rows: { owned?: Record<string, number>; loadout?: string[] },
  ): void {
    const stored = this.require(characterId);
    for (const [skillId, level] of Object.entries(rows.owned ?? {}))
      stored.owned.set(skillId, level);
    if (rows.loadout !== undefined) stored.loadout = [...rows.loadout];
  }

  versionOf(characterId: string): bigint {
    return this.require(characterId).version;
  }

  loadSkillState(authUserId: string, characterId: string): Promise<SkillState | null> {
    const stored = this.characters.get(characterId);
    if (stored?.authUserId !== authUserId) return Promise.resolve(null);
    try {
      return Promise.resolve({
        version: stored.version,
        skills: createCharacterSkills({
          owned: [...stored.owned].map(([id, level]) => ({
            id: SkillDefinitionId.parse(id),
            level: SkillLevel.of(level),
          })),
          loadout: stored.loadout.map((id) => SkillDefinitionId.parse(id)),
        }),
      });
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async replaceLoadout(command: ReplaceSkillLoadoutCommand): Promise<'saved' | 'conflict'> {
    await this.beforeReplace?.();
    const stored = this.characters.get(command.characterId);
    if (stored?.authUserId !== command.authUserId || stored.version !== command.expectedVersion) {
      return 'conflict';
    }
    stored.loadout = command.loadout.map((id) => id.toString());
    stored.version += 1n;
    this.replacements += 1;
    return 'saved';
  }

  saveTrustedSkill(grant: TrustedSkillGrant): Promise<void> {
    SKILL_CATALOG.require(grant.skillId);
    const stored = this.require(grant.characterId);
    stored.owned.set(grant.skillId.toString(), grant.level.toNumber());
    stored.version += 1n;
    return Promise.resolve();
  }

  /** Convenience for fixtures: grant several skills at their levels. */
  async grant(characterId: string, skills: Record<string, number>): Promise<void> {
    for (const [id, level] of Object.entries(skills)) {
      await this.saveTrustedSkill({
        characterId,
        skillId: SkillDefinitionId.parse(id),
        level: SkillLevel.of(level),
      });
    }
  }

  private require(characterId: string): StoredSkills {
    const stored = this.characters.get(characterId);
    if (stored === undefined) throw new Error(`Unknown character ${characterId}.`);
    return stored;
  }
}
