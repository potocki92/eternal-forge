import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { handleSmokeJob, SMOKE_QUEUE, type SmokeJobResult } from './smoke-job.js';

export interface SmokeWorkerOptions {
  readonly connection: Redis;
  readonly concurrency: number;
  readonly logger: Logger;
}

/**
 * BullMQ adapter around {@link handleSmokeJob}.
 *
 * Holds no rules of its own: it unwraps the job, delegates, and logs.
 */
export function createSmokeWorker(options: SmokeWorkerOptions): Worker {
  const worker = new Worker(
    SMOKE_QUEUE,
    (job: Job): Promise<SmokeJobResult> => Promise.resolve(handleSmokeJob(job.data, Date.now())),
    { connection: options.connection, concurrency: options.concurrency },
  );

  worker.on('completed', (job, result: SmokeJobResult) => {
    options.logger.info(
      { jobId: job.id, requestId: result.requestId, latencyMs: result.latencyMs },
      'Smoke job completed',
    );
  });

  worker.on('failed', (job, error) => {
    options.logger.error({ jobId: job?.id, err: error }, 'Smoke job failed');
  });

  return worker;
}
