import { z } from 'zod';

/**
 * A URL restricted to an allow-list of protocols.
 *
 * Implemented with the WHATWG URL parser rather than a regular expression so
 * the accepted shape matches what the driver will actually dial.
 */
export function urlWithProtocol(protocols: readonly string[], label: string): z.ZodString {
  const allowed = new Set(protocols);
  return z.string().refine(
    (value) => {
      try {
        return allowed.has(new URL(value).protocol);
      } catch {
        return false;
      }
    },
    { message: `must be a valid ${label} URL (${protocols.join(', ')})` },
  );
}

/** A non-empty secret. The minimum length is a typo guard, not a strength check. */
export function secret(minLength = 16): z.ZodString {
  return z.string().min(minLength, { message: `must be at least ${minLength} characters` });
}

/** Parses `"a, b"` style environment lists into a trimmed string array. */
export const csvList = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  )
  .pipe(z.array(z.string()));

/**
 * Parses a bounded integer. Environment variables always arrive as strings, so
 * the default is expressed on the input side.
 */
export function boundedInt(defaultValue: number, min: number, max: number) {
  return z
    .string()
    .default(String(defaultValue))
    .pipe(
      z
        .string()
        .regex(/^\d+$/u, { message: 'must be a non-negative integer' })
        .transform(Number)
        .refine((value) => value >= min && value <= max, {
          message: `must be between ${min} and ${max}`,
        }),
    );
}

/** A TCP port number. */
export function port(defaultValue: number) {
  return boundedInt(defaultValue, 1, 65535);
}
