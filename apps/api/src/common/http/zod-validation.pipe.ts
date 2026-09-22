import { HttpStatus, Injectable, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { ApiException } from './api-exception.js';

/**
 * Validates a request payload against a shared contract schema and returns the
 * parsed (normalised) value.
 *
 * Only issue paths and messages reach the client. Received values are never
 * echoed back, so the error cannot reflect hostile input.
 */
@Injectable()
export class ZodValidationPipe<TSchema extends z.ZodType> implements PipeTransform<
  unknown,
  z.output<TSchema>
> {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): z.output<TSchema> {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'The request is invalid.',
        {
          issues: result.error.issues.map((issue) => ({
            path: issue.path.map(String).join('.'),
            message: issue.message,
          })),
        },
      );
    }

    return result.data;
  }
}
