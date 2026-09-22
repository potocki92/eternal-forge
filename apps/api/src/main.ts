import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loadApiEnv, loadEnvFiles } from '@eternal-forge/config/server';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/http/all-exceptions.filter.js';
import { createPinoLogger, PinoLoggerService } from './common/logging/logger.js';

async function bootstrap(): Promise<void> {
  loadEnvFiles();

  const env = loadApiEnv();
  const logger = createPinoLogger({
    level: env.LOG_LEVEL,
    pretty: env.NODE_ENV === 'development',
    version: env.SERVICE_VERSION,
  });

  const app = await NestFactory.create(AppModule, {
    logger: new PinoLoggerService(logger),
  });

  app.use(helmet());
  app.enableCors({ origin: env.API_CORS_ORIGINS, credentials: true });
  app.useGlobalFilters(new AllExceptionsFilter(logger));
  // Drains in-flight requests on SIGTERM instead of dropping them.
  app.enableShutdownHooks();

  await app.listen(env.API_PORT);

  // `service` and `version` are already part of every record's base fields.
  logger.info({ port: env.API_PORT, environment: env.NODE_ENV }, 'API listening');
}

void bootstrap();
