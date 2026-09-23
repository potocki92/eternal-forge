import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { STATUS_CODES } from 'node:http';
import type { ApiErrorCode, ApiErrorResponse } from '@eternal-forge/contracts';
import type { Request, Response } from 'express';
import type { Logger } from 'pino';
import { ApiException } from './api-exception.js';
import { REQUEST_ID_HEADER } from './request-id.middleware.js';

/**
 * Converts any unhandled error into a safe response matching the shared
 * `ApiErrorResponse` contract.
 *
 * Clients receive a status code, a machine-readable code and a generic reason.
 * Stack traces, driver messages and SQL never cross the boundary; the full error
 * is logged server-side instead (docs/SECURITY.md — "Error handling").
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const status: number =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const requestId = request.header(REQUEST_ID_HEADER);

    // An ApiException is a deliberate, already-explained response; anything
    // else reaching 5xx is a defect and is logged with its full detail.
    if (status >= 500 && !(exception instanceof ApiException)) {
      this.logger.error(
        { requestId, path: request.path, method: request.method, err: exception },
        'Unhandled request failure',
      );
    }

    const body: ApiErrorResponse = {
      statusCode: status,
      code: codeFor(exception, status),
      // Only ApiException messages are written for clients. Anything else is
      // replaced by the standard status phrase: framework messages can quote
      // the request (a JSON parse error echoes part of the body), and other
      // errors can carry driver or SQL detail.
      error:
        exception instanceof ApiException ? exception.message : (STATUS_CODES[status] ?? 'Error'),
      ...(requestId === undefined ? {} : { requestId }),
      ...(exception instanceof ApiException && exception.details.issues !== undefined
        ? { issues: [...exception.details.issues] }
        : {}),
    };

    if (exception instanceof ApiException && exception.details.headers !== undefined) {
      response.set(exception.details.headers);
    }

    response.status(status).json(body);
  }
}

function codeFor(exception: unknown, status: number): ApiErrorCode {
  if (exception instanceof ApiException) {
    return exception.code;
  }
  if (status >= 500) {
    return 'INTERNAL_ERROR';
  }
  switch (status) {
    case 400:
      return 'VALIDATION_FAILED';
    case 401:
      return 'UNAUTHENTICATED';
    case 404:
      return 'NOT_FOUND';
    default:
      return 'HTTP_ERROR';
  }
}
