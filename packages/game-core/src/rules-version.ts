/**
 * Version of the gameplay rule set this build produces new results under.
 *
 * Deterministic simulations are reproducible only for a fixed
 * `(input, seed, rulesVersion)` triple: a replay recorded before a balance patch
 * would otherwise resolve differently afterwards (docs/ARCHITECTURE.md — "Rules
 * version"). Every persisted simulation result must record the value in force
 * when it was produced.
 *
 * Bump this whenever a change alters the outcome of an existing simulation —
 * including changes to HugeNumber rounding, the RNG algorithm or seed hashing,
 * not only balance values. Adding new content that no prior simulation could
 * reference does not require a bump.
 *
 * History:
 * - 0 — Phase 0. No gameplay rules existed.
 * - 1 — Phase 1. First combat, stage scaling and reward rules (`RULES_V1`).
 */
export const GAME_RULES_VERSION = 1 as const;

export type GameRulesVersion = typeof GAME_RULES_VERSION;
