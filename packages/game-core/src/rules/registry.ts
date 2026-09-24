import { GameCoreError } from '../errors.js';
import { HugeNumber } from '../huge-number/index.js';
import type { GameRules } from './game-rules.js';
import { RULES_V1 } from './v1.js';
import { RULES_V2 } from './v2.js';

/** Rule sets are shared, immutable data; freezing makes accidental mutation fail loudly. */
function deepFreeze<T extends object>(value: T): Readonly<T> {
  const children: readonly unknown[] = Object.values(value);
  for (const child of children) {
    if (typeof child === 'object' && child !== null && !(child instanceof HugeNumber)) {
      deepFreeze(child);
    }
  }
  return Object.freeze(value);
}

/**
 * Every rule set this build can execute, keyed by version.
 *
 * A persisted simulation records the version it ran under. Replaying it looks
 * the rules up here, so a rule set is removed only when no persisted result can
 * still reference it.
 */
const RULES_BY_VERSION: ReadonlyMap<number, GameRules> = new Map(
  [RULES_V1, RULES_V2].map((rules) => [rules.version, deepFreeze(rules)] as const),
);

export function getGameRules(version: number): GameRules {
  const rules = RULES_BY_VERSION.get(version);
  if (rules === undefined) {
    throw new GameCoreError(
      'UNSUPPORTED_RULES_VERSION',
      `Game rules version ${String(version)} is not supported by this build.`,
    );
  }
  return rules;
}

export function supportedRulesVersions(): readonly number[] {
  return [...RULES_BY_VERSION.keys()];
}
