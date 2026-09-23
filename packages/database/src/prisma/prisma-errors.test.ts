import { describe, expect, it } from 'vitest';
import { Prisma } from '../../generated/prisma/index.js';
import { isUniqueConstraintViolation } from './prisma-errors.js';

function knownError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('failed', { code, clientVersion: 'test' });
}

describe('isUniqueConstraintViolation', () => {
  it('recognises P2002', () => {
    expect(isUniqueConstraintViolation(knownError('P2002'))).toBe(true);
  });

  it.each([knownError('P2025'), new Error('P2002'), 'P2002', undefined])(
    'rejects anything else (%s)',
    (error) => {
      expect(isUniqueConstraintViolation(error)).toBe(false);
    },
  );
});
