import { Prisma } from '../../generated/prisma/index.js';

/** Prisma's code for a violated unique constraint. */
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * Whether `error` is a unique-constraint violation reported by Prisma.
 *
 * Repositories use it to turn a lost insert race into a domain answer, such as
 * "this idempotency key already has a result", without importing Prisma's
 * error classes themselves.
 */
export function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_CONSTRAINT_VIOLATION
  );
}
