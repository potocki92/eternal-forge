import { loadEnvFiles, loadWorkerEnv } from '@eternal-forge/config/server';
import { createLogger } from './runtime/logger.js';
import { createQueueConnection } from './runtime/redis-connection.js';
import { createSmokeWorker } from './smoke/smoke-worker.js';

async function bootstrap(): Promise<void> {
  loadEnvFiles();

  const env = loadWorkerEnv();
  const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development', env.SERVICE_VERSION);
  const connection = createQueueConnection(env.REDIS_URL);

  const worker = createSmokeWorker({
    connection,
    concurrency: env.WORKER_CONCURRENCY,
    logger,
  });

  // `service` and `version` are already part of every record's base fields.
  logger.info({ environment: env.NODE_ENV, concurrency: env.WORKER_CONCURRENCY }, 'Worker started');

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, 'Shutting down');
    // `close()` lets in-flight jobs finish before the connection drops, so a
    // deploy never abandons work mid-flight.
    void worker
      .close()
      .then(() => connection.quit())
      .then(() => {
        process.exit(0);
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, 'Shutdown failed');
        process.exit(1);
      });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return Promise.resolve();
}

void bootstrap();
