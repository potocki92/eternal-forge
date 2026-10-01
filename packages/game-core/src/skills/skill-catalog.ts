import { GameCoreError } from '../errors.js';
import type { SkillDefinition, SkillDefinitionInput } from './skill-definition.js';
import { createSkillDefinition } from './skill-definition.js';
import type { SkillDefinitionId } from './skill-definition-id.js';

/**
 * The candidate active skills named by docs/GAME_DESIGN.md — "Skills".
 *
 * Identities only. None of them has approved gameplay yet, so this catalog
 * carries no cooldown, damage or effect: those arrive as versioned tuning
 * (ADR-031). Declaration order is for review and presentation; it is never a
 * cast priority.
 */
const CANDIDATE_DEFINITIONS = [
  { id: 'whirlwind', nameKey: 'skill.whirlwind.name' },
  { id: 'fireball', nameKey: 'skill.fireball.name' },
  { id: 'execute', nameKey: 'skill.execute.name' },
  { id: 'blood_strike', nameKey: 'skill.blood_strike.name' },
  { id: 'lightning_chain', nameKey: 'skill.lightning_chain.name' },
  { id: 'shield', nameKey: 'skill.shield.name' },
] as const;

/** Immutable, deterministic static-content registry with constant-time lookup. */
export class SkillCatalog {
  private readonly byId: ReadonlyMap<string, SkillDefinition>;
  private readonly ordered: readonly SkillDefinition[];

  /** @throws {GameCoreError} `INVALID_FORMAT` or `DUPLICATE_SKILL_DEFINITION`. */
  public constructor(inputs: readonly SkillDefinitionInput[]) {
    const byId = new Map<string, SkillDefinition>();
    const definitions = inputs.map(createSkillDefinition);
    for (const definition of definitions) {
      const key = definition.id.toString();
      if (byId.has(key)) {
        throw new GameCoreError(
          'DUPLICATE_SKILL_DEFINITION',
          `Duplicate skill definition ID: "${key}".`,
        );
      }
      byId.set(key, definition);
    }
    this.byId = byId;
    this.ordered = Object.freeze([...definitions]);
    Object.freeze(this);
  }

  public get(id: SkillDefinitionId): SkillDefinition | undefined {
    return this.byId.get(id.toString());
  }

  /** @throws {GameCoreError} `UNKNOWN_SKILL_DEFINITION` for an identity this catalog lacks. */
  public require(id: SkillDefinitionId): SkillDefinition {
    const definition = this.get(id);
    if (definition === undefined) {
      throw new GameCoreError(
        'UNKNOWN_SKILL_DEFINITION',
        `Unknown skill definition ID: "${id.toString()}".`,
      );
    }
    return definition;
  }

  /** Declaration order, one frozen view. Not a cast priority (ADR-031). */
  public definitions(): readonly SkillDefinition[] {
    return this.ordered;
  }
}

export const SKILL_CATALOG = new SkillCatalog(CANDIDATE_DEFINITIONS);
