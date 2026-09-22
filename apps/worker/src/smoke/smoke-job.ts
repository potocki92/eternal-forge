import { z } from 'zod';

/** Name of the queue used to prove the worker pipeline is wired end to end. */
export const SMOKE_QUEUE = 'smoke';
export const SMOKE_JOB = 'ping';

export const smokeJobDataSchema = z.object({
  /** Correlation id supplied by whoever enqueued the job. */
  requestId: z.string().min(1),
  /** Epoch milliseconds recorded when the job was enqueued. */
  enqueuedAt: z.number().int().nonnegative(),
});

export type SmokeJobData = z.infer<typeof smokeJobDataSchema>;

export interface SmokeJobResult {
  readonly requestId: string;
  readonly pong: true;
  /** Time the job spent waiting in the queue, in milliseconds. */
  readonly latencyMs: number;
}

/**
 * Pure job handler.
 *
 * The processing rule is separated from the BullMQ wiring so it can be asserted
 * without Redis, in the same way gameplay logic will be in later phases.
 *
 * Job payloads arrive from outside this process and are validated, not trusted
 * (docs/SECURITY.md — "Input validation").
 */
export function handleSmokeJob(rawData: unknown, receivedAt: number): SmokeJobResult {
  const data = smokeJobDataSchema.parse(rawData);

  return {
    requestId: data.requestId,
    pong: true,
    latencyMs: Math.max(0, receivedAt - data.enqueuedAt),
  };
}
