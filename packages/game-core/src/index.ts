/**
 * Eternal Forge game core.
 *
 * Pure, deterministic gameplay rules. This package must remain free of
 * frameworks, I/O and ambient state so it can be executed inside a unit test,
 * inside the API process and inside a background worker with identical results
 * (CLAUDE.md — "Game Core").
 */
export { GameCoreError } from './errors.js';
export type { GameCoreErrorCode } from './errors.js';
export {
  HUGE_NUMBER_MAX_EXPONENT,
  HUGE_NUMBER_MIN_EXPONENT,
  HUGE_NUMBER_PRECISION,
  HUGE_NUMBER_ZERO_EXPONENT,
  HugeNumber,
} from './huge-number/index.js';
export type { HugeNumberParts } from './huge-number/index.js';
export { GAME_RULES_VERSION } from './rules-version.js';
export type { GameRulesVersion } from './rules-version.js';
