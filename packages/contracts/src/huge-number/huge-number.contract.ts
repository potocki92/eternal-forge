import { HugeNumber } from '@eternal-forge/game-core';
import { z } from 'zod';

/**
 * A HugeNumber on the wire: its canonical string, e.g. `"0"`, `"5e0"`,
 * `"1.5e3"` (ADR-013, section 2).
 *
 * The format is owned by Game Core. This schema delegates to
 * `HugeNumber.isCanonical`, so the rule exists exactly once. It is a string
 * because a JSON number cannot carry every value.
 */
export const hugeNumberSchema = z
  .string()
  .max(64)
  .refine((value) => HugeNumber.isCanonical(value), 'Must be a canonical HugeNumber.');
export type HugeNumberDto = z.infer<typeof hugeNumberSchema>;

/**
 * A non-negative HugeNumber: health, damage, gold, experience and rewards are
 * never negative. The canonical form of a negative value always starts with `-`.
 */
export const hugeAmountSchema = hugeNumberSchema.refine(
  (value) => !value.startsWith('-'),
  'Must not be negative.',
);
