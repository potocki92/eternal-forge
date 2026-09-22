/**
 * Version of the gameplay rule set this build implements.
 *
 * Deterministic simulations are reproducible only for a fixed
 * `(input, seed, rulesVersion)` triple: a replay recorded before a balance patch
 * would otherwise resolve differently afterwards (docs/ARCHITECTURE.md — "Rules
 * version"). Every persisted simulation result must record the value in force
 * when it was produced.
 *
 * Bump this whenever a change alters the outcome of an existing simulation.
 * Adding new content that no prior simulation could reference does not require a
 * bump.
 *
 * No gameplay rules exist yet — Phase 1 introduces the first ones.
 */
export const GAME_RULES_VERSION = 0 as const;

export type GameRulesVersion = typeof GAME_RULES_VERSION;
