import { HttpException, type HttpStatus } from '@nestjs/common';
import type { ApiErrorCode, ApiErrorIssue } from '@eternal-forge/contracts';

/**
 * An HTTP error with a machine-readable code from the shared contract.
 *
 * Presentation code throws these; {@link AllExceptionsFilter} renders them. The
 * message is written for the client and must never contain internal detail.
 */
export class ApiException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: ApiErrorCode,
    message: string,
    readonly details: {
      readonly issues?: readonly ApiErrorIssue[];
      /** Response headers the error requires, e.g. `WWW-Authenticate` on a 401. */
      readonly headers?: Readonly<Record<string, string>>;
    } = {},
  ) {
    super(message, status);
    this.name = 'ApiException';
  }
}
