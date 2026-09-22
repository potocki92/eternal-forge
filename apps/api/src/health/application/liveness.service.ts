import { Inject, Injectable } from '@nestjs/common';
import type { LivenessResponse } from '@eternal-forge/contracts';
import { SERVICE_NAME } from '../../app-info.js';
import { SERVICE_VERSION } from '../../config/api-config.module.js';
import { CLOCK, type Clock } from '../../common/clock/clock.port.js';

/**
 * Answers "is this process alive?".
 *
 * Deliberately free of dependency checks: an orchestrator must not restart a
 * healthy process because a cache is briefly unreachable.
 */
@Injectable()
export class LivenessService {
  private readonly startedAt: number;

  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(SERVICE_VERSION) private readonly version: string,
  ) {
    this.startedAt = clock.now().getTime();
  }

  check(): LivenessResponse {
    const now = this.clock.now();

    return {
      status: 'ok',
      service: SERVICE_NAME,
      version: this.version,
      uptimeSeconds: Math.max(0, (now.getTime() - this.startedAt) / 1000),
      serverTime: now.toISOString(),
    };
  }
}
