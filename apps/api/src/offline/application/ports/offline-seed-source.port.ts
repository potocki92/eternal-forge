/**
 * Where offline claim seeds come from (ADR-023).
 *
 * Production draws each seed from the operating system's CSPRNG, as for
 * combat (ADR-019 §2). A seed is drawn when a claim commits and stored as the
 * character's *next* claim seed, so it exists — unknown to the client — before
 * the claim that uses it, and asking again cannot draw a different one.
 */
export interface OfflineSeedSource {
  /** A fresh seed of 1 to 64 characters, never reused. */
  next(): string;
}

export const OFFLINE_SEED_SOURCE = Symbol('OFFLINE_SEED_SOURCE');
