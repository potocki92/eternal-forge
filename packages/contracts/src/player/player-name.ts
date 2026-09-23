import { z } from 'zod';

/**
 * The naming rule for player-visible names: profile display names and
 * character names.
 *
 * It is part of the API contract, so the web form and the API validate the same
 * rule from this one definition. The API domain re-checks it, and PostgreSQL
 * enforces the length and trimming invariants with CHECK constraints (ADR-017).
 *
 * - Normalised to Unicode NFC and trimmed before validation, so visually
 *   identical input produces identical stored text.
 * - 3–24 characters, counted in code points to match PostgreSQL's
 *   `char_length`, not UTF-16 units.
 * - Letters and digits from any script, with single separators (space,
 *   hyphen, underscore, apostrophe, period) between them. No leading,
 *   trailing or repeated separators, no control or invisible characters.
 */
export const PLAYER_NAME_MIN_LENGTH = 3;
export const PLAYER_NAME_MAX_LENGTH = 24;

const PLAYER_NAME_PATTERN = /^[\p{L}\p{N}]+(?:[ _.'-][\p{L}\p{N}]+)*$/u;

/** Canonical form of a player name. Pure; exposed so callers can preview it. */
export function normalizePlayerName(raw: string): string {
  return raw.normalize('NFC').trim();
}

/** Reason a name is rejected, or `undefined` when it is valid. Expects normalised input. */
export function playerNameProblem(name: string): string | undefined {
  const length = codePointLength(name);
  if (length < PLAYER_NAME_MIN_LENGTH) {
    return `must be at least ${PLAYER_NAME_MIN_LENGTH} characters`;
  }
  if (length > PLAYER_NAME_MAX_LENGTH) {
    return `must be at most ${PLAYER_NAME_MAX_LENGTH} characters`;
  }
  if (!PLAYER_NAME_PATTERN.test(name)) {
    return 'may contain letters, digits and single spaces, hyphens, underscores, apostrophes or periods between them';
  }
  return undefined;
}

/** Matches PostgreSQL's `char_length`: code points, not UTF-16 units or graphemes. */
function codePointLength(value: string): number {
  let length = 0;
  for (const _codePoint of value) {
    length += 1;
  }
  return length;
}

export const playerNameSchema = z
  .string()
  // Bounds the work done on hostile input before normalisation.
  .max(256)
  .transform(normalizePlayerName)
  .superRefine((name, context) => {
    const problem = playerNameProblem(name);
    if (problem !== undefined) {
      context.addIssue({ code: 'custom', message: problem });
    }
  });
