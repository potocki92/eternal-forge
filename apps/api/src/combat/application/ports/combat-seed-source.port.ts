/**
 * Where combat seeds come from (ADR-019, "The seed").
 *
 * Production draws each seed from the operating system's CSPRNG, so no client
 * can predict or choose it. Tests inject fixed seeds to make combats
 * reproducible.
 */
export interface CombatSeedSource {
  /** A fresh seed of 1 to 64 characters, never reused. */
  next(): string;
}

export const COMBAT_SEED_SOURCE = Symbol('COMBAT_SEED_SOURCE');
