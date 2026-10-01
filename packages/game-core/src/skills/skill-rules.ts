import { GameCoreError } from '../errors.js';
import type { HugeNumber } from '../huge-number/index.js';
import type { HugeNumberLevelCurve, IntegerLevelCurve, IntegerRange } from './level-curve.js';
import {
  createHugeNumberLevelCurve,
  createIntegerLevelCurve,
  hugeNumberCurveAt,
  integerCurveAt,
} from './level-curve.js';
import type { SkillCatalog } from './skill-catalog.js';
import { SKILL_COOLDOWN_MIN_MS, SKILL_DURATION_MAX_MS } from './skill-cooldown.js';
import type { SkillDefinition } from './skill-definition.js';
import { SkillDefinitionId } from './skill-definition-id.js';
import { SkillLevel } from './skill-level.js';

/**
 * Skill tuning: the balance half of a skill (ADR-031).
 *
 * A `SkillDefinition` is durable identity. Its tuning — cooldown and the
 * level-scaled parameters a future effect reads — is balance, and balance
 * that affects combat is versioned with the combat rules. A `SkillRules`
 * value is therefore built from data and validated against a catalog, and is
 * not registered in any `GameRules` yet: no rule set this build executes
 * contains skills, and none of rules v1–v3 ever did.
 *
 * Effect *semantics* (what a parameter does in combat) are deliberately not
 * modelled: no effect is approved. A parameter is a named, unit-typed level
 * curve; the combat runtime that later gives a skill an effect declares which
 * parameters that effect reads.
 */

/** Units a skill parameter can carry, matching the project's numeric conventions. */
export const SKILL_PARAMETER_UNITS = ['HUGE_NUMBER', 'BASIS_POINTS', 'MILLISECONDS'] as const;
export type SkillParameterUnit = (typeof SKILL_PARAMETER_UNITS)[number];

export const SKILL_PARAMETER_NAME_MAX_LENGTH = 64;
const PARAMETER_NAME_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;

const COOLDOWN_RANGE: IntegerRange = { min: SKILL_COOLDOWN_MIN_MS, max: SKILL_DURATION_MAX_MS };
const PARAMETER_RANGES: Readonly<Record<'BASIS_POINTS' | 'MILLISECONDS', IntegerRange>> = {
  BASIS_POINTS: { min: 0, max: Number.MAX_SAFE_INTEGER },
  MILLISECONDS: { min: 0, max: SKILL_DURATION_MAX_MS },
};

export type SkillParameterTuning =
  | {
      readonly name: string;
      readonly unit: 'HUGE_NUMBER';
      readonly curve: HugeNumberLevelCurve;
    }
  | {
      readonly name: string;
      readonly unit: 'BASIS_POINTS' | 'MILLISECONDS';
      readonly curve: IntegerLevelCurve;
    };

export interface SkillTuningInput {
  /** Must name a definition of the catalog the rules are built against. */
  readonly skillId: string;
  /** Cooldown in combat milliseconds; `perLevel: 0` for a constant cooldown. */
  readonly cooldownMs: IntegerLevelCurve;
  /** Named level curves; input order is irrelevant. */
  readonly parameters?: readonly SkillParameterTuning[];
}

export interface SkillTuning {
  readonly skillId: SkillDefinitionId;
  readonly cooldownMs: IntegerLevelCurve;
  /** Sorted by name (code-unit order), so resolution order is canonical. */
  readonly parameters: readonly SkillParameterTuning[];
}

export type ResolvedSkillParameter =
  | { readonly name: string; readonly unit: 'HUGE_NUMBER'; readonly value: HugeNumber }
  | {
      readonly name: string;
      readonly unit: 'BASIS_POINTS' | 'MILLISECONDS';
      readonly value: number;
    };

/**
 * One skill at one level, with every value resolved: the input a future combat
 * runtime consumes and a future combat snapshot records. Serialises to a
 * stable JSON fingerprint (identity and HugeNumbers as canonical strings).
 */
export interface ResolvedSkill {
  readonly id: SkillDefinitionId;
  readonly level: SkillLevel;
  /** Combat milliseconds from a cast until the skill is ready again. */
  readonly cooldownMs: number;
  /** Sorted by name. */
  readonly parameters: readonly ResolvedSkillParameter[];
}

function compareNames(first: string, second: string): number {
  if (first === second) return 0;
  return first < second ? -1 : 1;
}

function createParameter(input: SkillParameterTuning, owner: string): SkillParameterTuning {
  if (
    input.name.length > SKILL_PARAMETER_NAME_MAX_LENGTH ||
    !PARAMETER_NAME_PATTERN.test(input.name)
  ) {
    throw new GameCoreError(
      'INVALID_FORMAT',
      `${owner}: parameter name must be 1–64 lowercase letters, digits or single underscores, starting with a letter.`,
    );
  }
  const field = `${owner}.${input.name}`;
  if (input.unit === 'HUGE_NUMBER') {
    return Object.freeze({
      name: input.name,
      unit: input.unit,
      curve: createHugeNumberLevelCurve(input.curve, field),
    });
  }
  const parameter = Object.freeze({
    name: input.name,
    unit: input.unit,
    curve: createIntegerLevelCurve(input.curve, field),
  });
  // A curve must at least be legal at level 1; later levels are checked when resolved.
  integerCurveAt(parameter.curve, SkillLevel.FIRST, PARAMETER_RANGES[parameter.unit], field);
  return parameter;
}

function createTuning(input: SkillTuningInput, catalog: SkillCatalog): SkillTuning {
  const definition = catalog.require(SkillDefinitionId.parse(input.skillId));
  const owner = `skill "${definition.id.toString()}"`;
  const cooldownMs = createIntegerLevelCurve(input.cooldownMs, `${owner}.cooldownMs`);
  integerCurveAt(cooldownMs, SkillLevel.FIRST, COOLDOWN_RANGE, `${owner}.cooldownMs`);

  const parameters = (input.parameters ?? [])
    .map((parameter) => createParameter(parameter, owner))
    .sort((first, second) => compareNames(first.name, second.name));
  for (let index = 1; index < parameters.length; index += 1) {
    const name = parameters[index]?.name;
    if (name !== undefined && name === parameters[index - 1]?.name) {
      throw new GameCoreError('INVALID_ARGUMENT', `${owner}: duplicate parameter "${name}".`);
    }
  }
  return Object.freeze({
    skillId: definition.id,
    cooldownMs,
    parameters: Object.freeze(parameters),
  });
}

/**
 * A validated, immutable set of skill tunings over one catalog.
 *
 * Not every catalog skill needs a tuning: a skill without one is known but
 * unavailable under these rules. Tuning order is irrelevant; lookups are by
 * identity and listing follows the catalog's declaration order.
 */
export class SkillRules {
  private readonly byId: ReadonlyMap<string, SkillTuning>;
  private readonly ordered: readonly SkillTuning[];

  /**
   * @throws {GameCoreError} `UNKNOWN_SKILL_DEFINITION` for a skill outside the
   *   catalog, `DUPLICATE_SKILL_DEFINITION` for two tunings of one skill, and
   *   the curve errors for invalid values.
   */
  public constructor(
    private readonly catalog: SkillCatalog,
    inputs: readonly SkillTuningInput[],
  ) {
    const byId = new Map<string, SkillTuning>();
    for (const input of inputs) {
      const tuning = createTuning(input, catalog);
      const key = tuning.skillId.toString();
      if (byId.has(key)) {
        throw new GameCoreError(
          'DUPLICATE_SKILL_DEFINITION',
          `Duplicate tuning for skill "${key}".`,
        );
      }
      byId.set(key, tuning);
    }
    this.byId = byId;
    this.ordered = Object.freeze(
      catalog.definitions().flatMap((definition) => byId.get(definition.id.toString()) ?? []),
    );
    Object.freeze(this);
  }

  /**
   * @throws {GameCoreError} `UNKNOWN_SKILL_DEFINITION` for a skill outside the
   *   catalog, `SKILL_UNAVAILABLE` for a known skill without tuning.
   */
  public require(id: SkillDefinitionId): SkillTuning {
    const definition = this.catalog.require(id);
    const tuning = this.byId.get(definition.id.toString());
    if (tuning === undefined) {
      throw new GameCoreError(
        'SKILL_UNAVAILABLE',
        `Skill "${id.toString()}" has no tuning in these skill rules.`,
      );
    }
    return tuning;
  }

  /** Every tuning, in catalog declaration order. Not a cast priority. */
  public tunings(): readonly SkillTuning[] {
    return this.ordered;
  }
}

function resolveParameter(
  parameter: SkillParameterTuning,
  level: SkillLevel,
  owner: string,
): ResolvedSkillParameter {
  if (parameter.unit === 'HUGE_NUMBER') {
    return Object.freeze({
      name: parameter.name,
      unit: parameter.unit,
      value: hugeNumberCurveAt(parameter.curve, level),
    });
  }
  return Object.freeze({
    name: parameter.name,
    unit: parameter.unit,
    value: integerCurveAt(
      parameter.curve,
      level,
      PARAMETER_RANGES[parameter.unit],
      `${owner}.${parameter.name}`,
    ),
  });
}

/**
 * Resolves a skill at a level under the given skill rules. A pure function:
 * identical `(definition, level, rules)` always give an identical result.
 *
 * @throws {GameCoreError} `UNKNOWN_SKILL_DEFINITION`, `SKILL_UNAVAILABLE`,
 *   `OUT_OF_RANGE` if a curve leaves its legal range at this level, or
 *   `OVERFLOW` if a HugeNumber curve does.
 */
export function resolveSkillAtLevel(
  definition: SkillDefinition,
  level: SkillLevel,
  rules: SkillRules,
): ResolvedSkill {
  const tuning = rules.require(definition.id);
  const owner = `skill "${definition.id.toString()}"`;
  return Object.freeze({
    id: tuning.skillId,
    level,
    cooldownMs: integerCurveAt(tuning.cooldownMs, level, COOLDOWN_RANGE, `${owner}.cooldownMs`),
    parameters: Object.freeze(
      tuning.parameters.map((parameter) => resolveParameter(parameter, level, owner)),
    ),
  });
}
