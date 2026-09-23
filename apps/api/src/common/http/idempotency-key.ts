import { HttpStatus } from '@nestjs/common';
import { IDEMPOTENCY_KEY_HEADER, idempotencyKeySchema } from '@eternal-forge/contracts';
import { ApiException } from './api-exception.js';

/**
 * The `Idempotency-Key` header of a command that must not run twice: a UUID
 * naming one player intent (ADR-019 §6, ADR-023). A missing or malformed key
 * is a validation error; the submitted value is never echoed back.
 */
export function parseIdempotencyKey(value: string | undefined): string {
  const parsed = idempotencyKeySchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiException(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'The request is invalid.', {
      issues: [
        {
          path: `headers.${IDEMPOTENCY_KEY_HEADER}`,
          message: 'A UUID idempotency key is required.',
        },
      ],
    });
  }
  return parsed.data;
}
