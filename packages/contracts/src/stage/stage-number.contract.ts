import { z } from 'zod';

/** Largest stage number: the PostgreSQL `bigint` maximum, `2^63 − 1` (ADR-018). */
export const STAGE_NUMBER_WIRE_MAX = '9223372036854775807';

const CANONICAL_STAGE_NUMBER = /^[1-9][0-9]{0,18}$/u;

/**
 * A stage number on the wire: its canonical decimal string, `"1"` to
 * `"9223372036854775807"`, without sign, leading zeros, exponent or separators.
 *
 * A string, because a JSON number is parsed into a double and silently loses
 * precision above 2^53. Clients display it (a `BigInt` formats exactly) but
 * never compute gameplay from it. The API produces it from Game Core's
 * `StageNumber`, whose `toString`/`parse` use this same form.
 */
export const stageNumberSchema = z
  .string()
  .regex(CANONICAL_STAGE_NUMBER, 'Stage number must be a canonical decimal integer.')
  // Same digit count as the maximum: compare as strings, no numeric conversion.
  .refine(
    (value) => value.length < STAGE_NUMBER_WIRE_MAX.length || value <= STAGE_NUMBER_WIRE_MAX,
    'Stage number is out of range.',
  );
export type StageNumberDto = z.infer<typeof stageNumberSchema>;
