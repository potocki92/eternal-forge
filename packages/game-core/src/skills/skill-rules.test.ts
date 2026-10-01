import { describe, expect, it } from 'vitest';
import { GameCoreError, type GameCoreErrorCode } from '../errors.js';
import { HugeNumber } from '../huge-number/index.js';
import {
  SKILL_CATALOG,
  SKILL_DURATION_MAX_MS,
  SKILL_LEVEL_MAX,
  SkillCatalog,
  SkillDefinitionId,
  SkillLevel,
  SkillRules,
  resolveSkillAtLevel,
  type SkillTuningInput,
} from './index.js';

/*
 * Every tuning below is a TEST FIXTURE that exercises the resolution
 * machinery. None of it is balance: no skill has approved numbers (ADR-031).
 */

const d = (text: string): HugeNumber => HugeNumber.fromDecimal(text);
const definition = (id: string) => SKILL_CATALOG.require(SkillDefinitionId.parse(id));

function expectCode(operation: () => unknown, code: GameCoreErrorCode): void {
  expect(operation).toThrow(GameCoreError);
  try {
    operation();
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

const FIXTURE: readonly SkillTuningInput[] = [
  {
    skillId: 'fireball',
    cooldownMs: { base: 5_000, perLevel: 0 },
    parameters: [
      { name: 'power', unit: 'HUGE_NUMBER', curve: { base: d('100'), growth: d('1.1') } },
      { name: 'multiplier_bp', unit: 'BASIS_POINTS', curve: { base: 15_000, perLevel: 250 } },
    ],
  },
  {
    skillId: 'shield',
    cooldownMs: { base: 12_000, perLevel: -100 },
    parameters: [
      { name: 'duration_ms', unit: 'MILLISECONDS', curve: { base: 3_000, perLevel: 0 } },
    ],
  },
];

const rules = new SkillRules(SKILL_CATALOG, FIXTURE);

describe('resolveSkillAtLevel', () => {
  it('resolves level 1 to the curve bases', () => {
    const skill = resolveSkillAtLevel(definition('fireball'), SkillLevel.FIRST, rules);
    expect(skill.id.toString()).toBe('fireball');
    expect(skill.level.toNumber()).toBe(1);
    expect(skill.cooldownMs).toBe(5_000);
    expect(JSON.stringify(skill.parameters)).toBe(
      JSON.stringify([
        { name: 'multiplier_bp', unit: 'BASIS_POINTS', value: 15_000 },
        { name: 'power', unit: 'HUGE_NUMBER', value: '1e2' },
      ]),
    );
  });

  it('resolves a higher level from the curves, exactly', () => {
    const skill = resolveSkillAtLevel(definition('fireball'), SkillLevel.of(11), rules);
    expect(skill.cooldownMs).toBe(5_000);
    const [multiplier, power] = skill.parameters;
    expect(multiplier).toEqual({ name: 'multiplier_bp', unit: 'BASIS_POINTS', value: 17_500 });
    expect(power?.unit).toBe('HUGE_NUMBER');
    expect(power?.value).toEqual(d('100').mul(d('1.1').pow(10)));
  });

  it('supports a level-dependent cooldown without a second cooldown system', () => {
    expect(resolveSkillAtLevel(definition('shield'), SkillLevel.of(1), rules).cooldownMs).toBe(
      12_000,
    );
    expect(resolveSkillAtLevel(definition('shield'), SkillLevel.of(51), rules).cooldownMs).toBe(
      7_000,
    );
  });

  it('is deterministic: identical inputs give identical, byte-identical results', () => {
    const level = SkillLevel.of(37);
    const first = resolveSkillAtLevel(definition('fireball'), level, rules);
    const second = resolveSkillAtLevel(definition('fireball'), SkillLevel.of(37), rules);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    const rebuilt = new SkillRules(SKILL_CATALOG, [...FIXTURE].reverse());
    expect(JSON.stringify(resolveSkillAtLevel(definition('fireball'), level, rebuilt))).toBe(
      JSON.stringify(first),
    );
  });

  it('keeps HugeNumber power beyond the JavaScript number range', () => {
    const huge = new SkillRules(SKILL_CATALOG, [
      {
        skillId: 'execute',
        cooldownMs: { base: 1_000, perLevel: 0 },
        parameters: [
          { name: 'power', unit: 'HUGE_NUMBER', curve: { base: d('1e300'), growth: d('10') } },
        ],
      },
    ]);
    const skill = resolveSkillAtLevel(definition('execute'), SkillLevel.of(1_001), huge);
    expect(skill.parameters[0]?.value).toEqual(d('1e1300'));
  });

  it('resolves the extreme legal level when the curves stay legal', () => {
    const skill = resolveSkillAtLevel(
      definition('fireball'),
      SkillLevel.of(SKILL_LEVEL_MAX),
      new SkillRules(SKILL_CATALOG, [
        {
          skillId: 'fireball',
          cooldownMs: { base: 5_000, perLevel: 0 },
          parameters: [
            { name: 'multiplier_bp', unit: 'BASIS_POINTS', curve: { base: 0, perLevel: 1 } },
            { name: 'power', unit: 'HUGE_NUMBER', curve: { base: d('1'), growth: d('1') } },
          ],
        },
      ]),
    );
    expect(skill.level.toNumber()).toBe(SKILL_LEVEL_MAX);
    expect(skill.parameters[0]?.value).toBe(SKILL_LEVEL_MAX - 1);
    expect(skill.parameters[1]?.value).toEqual(d('1'));
  });

  it('fails explicitly when a cooldown curve leaves its legal range at a level', () => {
    // 12 000 − 100 × (L − 1) reaches 0 at level 121: the cooldown minimum is 1 ms.
    expect(resolveSkillAtLevel(definition('shield'), SkillLevel.of(120), rules).cooldownMs).toBe(
      100,
    );
    expectCode(
      () => resolveSkillAtLevel(definition('shield'), SkillLevel.of(121), rules),
      'OUT_OF_RANGE',
    );
  });

  it('fails explicitly when a cooldown curve grows past the maximum', () => {
    const growing = new SkillRules(SKILL_CATALOG, [
      { skillId: 'execute', cooldownMs: { base: SKILL_DURATION_MAX_MS - 1, perLevel: 1 } },
    ]);
    expect(resolveSkillAtLevel(definition('execute'), SkillLevel.of(2), growing).cooldownMs).toBe(
      SKILL_DURATION_MAX_MS,
    );
    expectCode(
      () => resolveSkillAtLevel(definition('execute'), SkillLevel.of(3), growing),
      'OUT_OF_RANGE',
    );
  });

  it('fails explicitly when an integer parameter leaves its range', () => {
    const growing = new SkillRules(SKILL_CATALOG, [
      {
        skillId: 'execute',
        cooldownMs: { base: 1_000, perLevel: 0 },
        parameters: [
          {
            name: 'threshold_bp',
            unit: 'BASIS_POINTS',
            curve: { base: Number.MAX_SAFE_INTEGER - 1, perLevel: 1 },
          },
        ],
      },
    ]);
    expect(
      resolveSkillAtLevel(definition('execute'), SkillLevel.of(2), growing).parameters[0]?.value,
    ).toBe(Number.MAX_SAFE_INTEGER);
    expectCode(
      () => resolveSkillAtLevel(definition('execute'), SkillLevel.of(3), growing),
      'OUT_OF_RANGE',
    );
  });

  it('fails explicitly when a HugeNumber curve overflows', () => {
    const exploding = new SkillRules(SKILL_CATALOG, [
      {
        skillId: 'execute',
        cooldownMs: { base: 1_000, perLevel: 0 },
        parameters: [
          { name: 'power', unit: 'HUGE_NUMBER', curve: { base: d('1'), growth: d('1e9') } },
        ],
      },
    ]);
    expectCode(
      () => resolveSkillAtLevel(definition('execute'), SkillLevel.of(SKILL_LEVEL_MAX), exploding),
      'OVERFLOW',
    );
  });

  it('resolves a zero-base HugeNumber curve to exact zero even where its growth term overflows', () => {
    const growth = d('1e9');
    // Proof that the short-circuit is genuine: the growth term alone leaves the range.
    expectCode(() => growth.pow(SKILL_LEVEL_MAX - 1), 'OVERFLOW');

    const zeroBase = new SkillRules(SKILL_CATALOG, [
      {
        skillId: 'execute',
        cooldownMs: { base: 1_000, perLevel: 0 },
        parameters: [{ name: 'power', unit: 'HUGE_NUMBER', curve: { base: d('0'), growth } }],
      },
    ]);
    const first = resolveSkillAtLevel(
      definition('execute'),
      SkillLevel.of(SKILL_LEVEL_MAX),
      zeroBase,
    );
    const again = resolveSkillAtLevel(
      definition('execute'),
      SkillLevel.of(SKILL_LEVEL_MAX),
      zeroBase,
    );
    const power = first.parameters[0];
    if (power?.unit !== 'HUGE_NUMBER') {
      throw new Error('Expected one HUGE_NUMBER parameter.');
    }
    expect(power.value).toBe(HugeNumber.ZERO);
    expect(power.value.isZero()).toBe(true);
    expect(power.value.toString()).toBe(HugeNumber.ZERO.toString());
    expect(power.value.toParts()).toEqual(HugeNumber.ZERO.toParts());
    expect(JSON.stringify(again)).toBe(JSON.stringify(first));
    expect(JSON.stringify(first.parameters)).toBe(
      JSON.stringify([{ name: 'power', unit: 'HUGE_NUMBER', value: HugeNumber.ZERO }]),
    );
  });

  it('still overflows for the smallest non-zero base: only exact zero short-circuits', () => {
    const tiny = new SkillRules(SKILL_CATALOG, [
      {
        skillId: 'execute',
        cooldownMs: { base: 1_000, perLevel: 0 },
        parameters: [
          {
            name: 'power',
            unit: 'HUGE_NUMBER',
            curve: { base: d('1e-1000000'), growth: d('1e9') },
          },
        ],
      },
    ]);
    expectCode(
      () => resolveSkillAtLevel(definition('execute'), SkillLevel.of(SKILL_LEVEL_MAX), tiny),
      'OVERFLOW',
    );
  });

  it('refuses a known skill without tuning and an unknown skill', () => {
    expectCode(
      () => resolveSkillAtLevel(definition('whirlwind'), SkillLevel.FIRST, rules),
      'SKILL_UNAVAILABLE',
    );
    const foreign = new SkillCatalog([{ id: 'meteor', nameKey: 'skill.meteor.name' }]);
    const meteor = foreign.require(SkillDefinitionId.parse('meteor'));
    expectCode(
      () => resolveSkillAtLevel(meteor, SkillLevel.FIRST, rules),
      'UNKNOWN_SKILL_DEFINITION',
    );
  });

  it('returns frozen results', () => {
    const skill = resolveSkillAtLevel(definition('fireball'), SkillLevel.of(3), rules);
    expect(Object.isFrozen(skill)).toBe(true);
    expect(Object.isFrozen(skill.parameters)).toBe(true);
    for (const parameter of skill.parameters) expect(Object.isFrozen(parameter)).toBe(true);
    expect(Reflect.set(skill, 'cooldownMs', 0)).toBe(false);
  });
});

describe('SkillRules', () => {
  it('lists tunings in catalog order, whatever the input order', () => {
    const reversed = new SkillRules(SKILL_CATALOG, [...FIXTURE].reverse());
    expect(reversed.tunings().map((tuning) => tuning.skillId.toString())).toEqual([
      'fireball',
      'shield',
    ]);
  });

  it('sorts parameters canonically by name', () => {
    const tuning = rules.require(SkillDefinitionId.parse('fireball'));
    expect(tuning.parameters.map((parameter) => parameter.name)).toEqual([
      'multiplier_bp',
      'power',
    ]);
  });

  it('is immutable and isolated from its inputs', () => {
    const cooldown = { base: 5_000, perLevel: 0 };
    const isolated = new SkillRules(SKILL_CATALOG, [{ skillId: 'fireball', cooldownMs: cooldown }]);
    cooldown.base = 1;
    expect(resolveSkillAtLevel(definition('fireball'), SkillLevel.FIRST, isolated).cooldownMs).toBe(
      5_000,
    );
    const tuning = isolated.require(SkillDefinitionId.parse('fireball'));
    expect(Object.isFrozen(isolated)).toBe(true);
    expect(Object.isFrozen(isolated.tunings())).toBe(true);
    expect(Object.isFrozen(tuning)).toBe(true);
    expect(Object.isFrozen(tuning.cooldownMs)).toBe(true);
    expect(Reflect.set(tuning.cooldownMs, 'base', 1)).toBe(false);
  });

  it('rejects a tuning for a skill outside the catalog', () => {
    expectCode(
      () =>
        new SkillRules(SKILL_CATALOG, [
          { skillId: 'meteor', cooldownMs: { base: 1, perLevel: 0 } },
        ]),
      'UNKNOWN_SKILL_DEFINITION',
    );
    expectCode(
      () =>
        new SkillRules(SKILL_CATALOG, [
          { skillId: 'Meteor', cooldownMs: { base: 1, perLevel: 0 } },
        ]),
      'INVALID_FORMAT',
    );
  });

  it('rejects two tunings of one skill', () => {
    const entry = { skillId: 'fireball', cooldownMs: { base: 1_000, perLevel: 0 } };
    expectCode(() => new SkillRules(SKILL_CATALOG, [entry, entry]), 'DUPLICATE_SKILL_DEFINITION');
  });

  it.each([
    [{ base: 0, perLevel: 0 }, 'OUT_OF_RANGE'],
    [{ base: -5_000, perLevel: 0 }, 'OUT_OF_RANGE'],
    [{ base: SKILL_DURATION_MAX_MS + 1, perLevel: 0 }, 'OUT_OF_RANGE'],
    [{ base: 5_000.5, perLevel: 0 }, 'NOT_A_SAFE_INTEGER'],
    [{ base: 5_000, perLevel: 0.5 }, 'NOT_A_SAFE_INTEGER'],
    [{ base: Number.NaN, perLevel: 0 }, 'NOT_A_SAFE_INTEGER'],
    [{ base: 2 ** 53, perLevel: 0 }, 'NOT_A_SAFE_INTEGER'],
  ] as const)('rejects the cooldown curve %j', (cooldownMs, code) => {
    expectCode(() => new SkillRules(SKILL_CATALOG, [{ skillId: 'fireball', cooldownMs }]), code);
  });

  it('accepts the minimum cooldown of 1 ms', () => {
    const fastest = new SkillRules(SKILL_CATALOG, [
      { skillId: 'fireball', cooldownMs: { base: 1, perLevel: 0 } },
    ]);
    expect(resolveSkillAtLevel(definition('fireball'), SkillLevel.FIRST, fastest).cooldownMs).toBe(
      1,
    );
  });

  it.each([
    [{ name: 'Power', unit: 'BASIS_POINTS', curve: { base: 1, perLevel: 0 } }, 'INVALID_FORMAT'],
    [
      { name: 'a'.repeat(65), unit: 'BASIS_POINTS', curve: { base: 1, perLevel: 0 } },
      'INVALID_FORMAT',
    ],
    [{ name: 'chance_bp', unit: 'BASIS_POINTS', curve: { base: -1, perLevel: 0 } }, 'OUT_OF_RANGE'],
    [
      { name: 'chance_bp', unit: 'BASIS_POINTS', curve: { base: 0.25, perLevel: 0 } },
      'NOT_A_SAFE_INTEGER',
    ],
    [
      { name: 'duration_ms', unit: 'MILLISECONDS', curve: { base: -1, perLevel: 0 } },
      'OUT_OF_RANGE',
    ],
    [
      {
        name: 'duration_ms',
        unit: 'MILLISECONDS',
        curve: { base: SKILL_DURATION_MAX_MS + 1, perLevel: 0 },
      },
      'OUT_OF_RANGE',
    ],
    [
      { name: 'power', unit: 'HUGE_NUMBER', curve: { base: d('-1'), growth: d('1') } },
      'NEGATIVE_VALUE',
    ],
    [
      { name: 'power', unit: 'HUGE_NUMBER', curve: { base: d('1'), growth: d('0') } },
      'INVALID_ARGUMENT',
    ],
    [
      { name: 'power', unit: 'HUGE_NUMBER', curve: { base: d('1'), growth: d('-2') } },
      'INVALID_ARGUMENT',
    ],
  ] as const)('rejects the parameter %j', (parameter, code) => {
    expectCode(
      () =>
        new SkillRules(SKILL_CATALOG, [
          {
            skillId: 'fireball',
            cooldownMs: { base: 1_000, perLevel: 0 },
            parameters: [parameter],
          },
        ]),
      code,
    );
  });

  it('rejects a duplicate parameter name', () => {
    expectCode(
      () =>
        new SkillRules(SKILL_CATALOG, [
          {
            skillId: 'fireball',
            cooldownMs: { base: 1_000, perLevel: 0 },
            parameters: [
              { name: 'power', unit: 'BASIS_POINTS', curve: { base: 1, perLevel: 0 } },
              { name: 'power', unit: 'HUGE_NUMBER', curve: { base: d('1'), growth: d('1') } },
            ],
          },
        ]),
      'INVALID_ARGUMENT',
    );
  });
});
