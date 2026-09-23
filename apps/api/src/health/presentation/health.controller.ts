import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { LivenessResponse, ReadinessResponse } from '@eternal-forge/contracts';
import type { Response } from 'express';
import { Public } from '../../auth/presentation/public.decorator.js';
import { LivenessService } from '../application/liveness.service.js';
import { ReadinessService } from '../application/readiness.service.js';

/**
 * Transport adapter for the health use cases.
 *
 * Contains no rules: it calls an application service and translates the result
 * into an HTTP status (CLAUDE.md — "Controllers").
 */
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly liveness: LivenessService,
    private readonly readiness: ReadinessService,
  ) {}

  /** Liveness probe. Always 200 while the process can serve a request. */
  @Get()
  getLiveness(): LivenessResponse {
    return this.liveness.check();
  }

  /**
   * Readiness probe. Returns 503 when a dependency is unreachable so a load
   * balancer stops routing traffic here, while the body still reports which
   * dependency failed.
   */
  @Get('ready')
  async getReadiness(@Res({ passthrough: true }) response: Response): Promise<ReadinessResponse> {
    const result = await this.readiness.check();

    response.status(result.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);

    return result;
  }
}
