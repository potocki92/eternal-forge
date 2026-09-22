/**
 * Eternal Forge game core.
 *
 * Pure, deterministic gameplay rules. This package must remain free of
 * frameworks, I/O and ambient state so it can be executed inside a unit test,
 * inside the API process and inside a background worker with identical results
 * (CLAUDE.md — "Game Core").
 *
 * Phase 0 establishes the package boundary and its automated guard rails only.
 * Simulation primitives (HugeNumber, RNG, combat) arrive in Phase 1.
 */
export { GAME_RULES_VERSION } from './rules-version.js';
export type { GameRulesVersion } from './rules-version.js';
