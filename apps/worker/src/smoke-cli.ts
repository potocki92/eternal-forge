import { randomUUID } from 'node:crypto';
import { Queue, QueueEvents } from 'bullmq';
import { loadEnvFiles, loadWorkerEnv } from '@eternal-forge/config/server';
import { createQueueConnection } from './runtime/redis-connection.js';
import { SMOKE_JOB, SMOKE_QUEUE, type SmokeJobData } from './smoke/smoke-job.js';

const RESULT_TIMEOUT_MS = 10_000;

/**
 * Worker smoke check.
 *
 * Enqueues one job and waits for the running worker to complete it, proving the
 * API/queue/worker path is wired: `pnpm --filter @eternal-forge/worker smoke`.
 * Exits non-zero when the job does not complete, so it is usable as a
 * deployment gate.
 */
async function main(): Promise<void> {
  loadEnvFiles();

  const env = loadWorkerEnv();
  const connection = createQueueConnection(env.REDIS_URL);
  // QueueEvents needs its own connection because it issues blocking reads.
  // BullMQ never closes a connection it did not create, so this one is tracked
  // and closed here; otherwise the process would not exit.
  const eventsConnection = connection.duplicate();
  const queue = new Queue(SMOKE_QUEUE, { connection });
  const events = new QueueEvents(SMOKE_QUEUE, { connection: eventsConnection });

  try {
    await events.waitUntilReady();

    const data: SmokeJobData = { requestId: randomUUID(), enqueuedAt: Date.now() };
    const job = await queue.add(SMOKE_JOB, data, {
      removeOnComplete: true,
      removeOnFail: true,
    });

    const result: unknown = await job.waitUntilFinished(events, RESULT_TIMEOUT_MS);

    process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
  } finally {
    await events.close();
    await queue.close();
    await eventsConnection.quit();
    await connection.quit();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: String(error) })}\n`);
  process.exitCode = 1;
});
