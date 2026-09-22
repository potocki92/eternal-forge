import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Logger } from 'pino';
import { REQUEST_ID_HEADER } from './request-id.middleware.js';

interface ErrorBody {
  readonly statusCode: number;
  readonly error: string;
  readonly requestId: string | undefined;
}

/**
 * Converts any unhandled error into a safe response.
 *
 * Clients receive a status code and a generic reason only. Stack traces, driver
 * messages and SQL never cross the boundary; the full error is logged
 * server-side instead (docs/SECURITY.md — "Error handling").
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

    if (status >= 500) {
      this.logger.error(
        { requestId, path: request.url, method: request.method, err: exception },
        'Unhandled request failure',
      );
    }

    const body: ErrorBody = {
      statusCode: status,
      error: exception instanceof HttpException ? exception.message : 'Internal Server Error',
      requestId,
    };

    response.status(status).json(body);
  }
}
