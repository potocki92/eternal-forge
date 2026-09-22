import { Inject, Injectable } from '@nestjs/common';
import type { DependencyStatus, ReadinessResponse } from '@eternal-forge/contracts';
import { SERVICE_NAME } from '../../app-info.js';
import { SERVICE_VERSION } from '../../config/api-config.module.js';
import { CLOCK, type Clock } from './ports/clock.port.js';
import { DEPENDENCY_PROBES, type DependencyProbe } from './ports/dependency-probe.port.js';

/** A probe that has not answered within this budget counts as down. */
const PROBE_TIMEOUT_MS = 2_000;

/**
 * Aggregates dependency probes into a readiness verdict.
 *
 * Probes run concurrently and are individually time-boxed, so one unreachable
 * dependency cannot hold the health endpoint open for the whole request timeout.
 */
@Injectable()
export class ReadinessService {
  constructor(
    @Inject(DEPENDENCY_PROBES) private readonly probes: readonly DependencyProbe[],
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(SERVICE_VERSION) private readonly version: string,
  ) {}

  async check(): Promise<ReadinessResponse> {
    const dependencies = await Promise.all(this.probes.map((probe) => this.runProbe(probe)));

    return {
      status: dependencies.some((dependency) => dependency.status === 'down') ? 'down' : 'ok',
      service: SERVICE_NAME,
      version: this.version,
      serverTime: this.clock.now().toISOString(),
      dependencies,
    };
  }

  private async runProbe(probe: DependencyProbe): Promise<DependencyStatus> {
    const startedAt = this.clock.now().getTime();

    try {
      await withTimeout(probe.check(), PROBE_TIMEOUT_MS, probe.name);
      return { name: probe.name, status: 'ok', durationMs: this.elapsedSince(startedAt) };
    } catch (error) {
      return {
        name: probe.name,
        status: 'down',
        durationMs: this.elapsedSince(startedAt),
        // A generic reason only: driver errors can contain connection strings.
        detail: error instanceof ProbeTimeoutError ? 'timed out' : 'unreachable',
      };
    }
  }

  private elapsedSince(startedAt: number): number {
    return Math.max(0, this.clock.now().getTime() - startedAt);
  }
}

export class ProbeTimeoutError extends Error {
  constructor(name: string) {
    super(`Probe "${name}" timed out`);
    this.name = 'ProbeTimeoutError';
  }
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number, name: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new ProbeTimeoutError(name));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
