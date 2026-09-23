import type { Server } from 'node:http';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { livenessResponseSchema, readinessResponseSchema } from '@eternal-forge/contracts';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import {
  RequestIdMiddleware,
  REQUEST_ID_HEADER,
} from '../src/common/http/request-id.middleware.js';
import { LivenessService } from '../src/health/application/liveness.service.js';
import { ReadinessService } from '../src/health/application/readiness.service.js';
import { CLOCK } from '../src/common/clock/clock.port.js';
import { SERVICE_VERSION } from '../src/config/api-config.module.js';
import {
  DEPENDENCY_PROBES,
  type DependencyProbe,
} from '../src/health/application/ports/dependency-probe.port.js';
import { HealthController } from '../src/health/presentation/health.controller.js';

/**
 * Wires the real controller, middleware and application services, replacing only
 * the infrastructure probes. Nothing here needs PostgreSQL or Redis, so the
 * suite runs in CI without service containers.
 */
async function createApp(probes: readonly DependencyProbe[]): Promise<INestApplication> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [
      { provide: CLOCK, useValue: { now: () => new Date('2026-09-22T10:00:00.000Z') } },
      { provide: SERVICE_VERSION, useValue: '0.0.0-test' },
      { provide: DEPENDENCY_PROBES, useValue: probes },
      LivenessService,
      ReadinessService,
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  const requestId = new RequestIdMiddleware();
  app.use(requestId.use.bind(requestId));
  await app.init();
  return app;
}

let app: INestApplication | undefined;

/**
 * Nest declares `getHttpServer()` as `any`. With the Express adapter it returns
 * the underlying Node HTTP server, which is what supertest needs; the assertion
 * is confined to this one helper.
 */
function server(application: INestApplication): Server {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return application.getHttpServer();
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /health', () => {
  it('returns 200 with a payload matching the shared contract', async () => {
    app = await createApp([]);

    const response = await request(server(app)).get('/health').expect(200);

    expect(livenessResponseSchema.parse(response.body)).toMatchObject({
      status: 'ok',
      service: 'eternal-forge-api',
    });
  });

  it('echoes a correlation id', async () => {
    app = await createApp([]);

    const response = await request(server(app))
      .get('/health')
      .set(REQUEST_ID_HEADER, 'trace-abc-123');

    expect(response.headers[REQUEST_ID_HEADER]).toBe('trace-abc-123');
  });

  it('stays healthy while a dependency is down', async () => {
    app = await createApp([{ name: 'redis', check: () => Promise.reject(new Error('refused')) }]);

    await request(server(app)).get('/health').expect(200);
  });
});

describe('GET /health/ready', () => {
  it('returns 200 when every dependency answers', async () => {
    app = await createApp([
      { name: 'postgres', check: () => Promise.resolve() },
      { name: 'redis', check: () => Promise.resolve() },
    ]);

    const response = await request(server(app)).get('/health/ready').expect(200);

    expect(readinessResponseSchema.parse(response.body).status).toBe('ok');
  });

  it('returns 503 and names the failing dependency', async () => {
    app = await createApp([
      { name: 'postgres', check: () => Promise.resolve() },
      { name: 'redis', check: () => Promise.reject(new Error('refused')) },
    ]);

    const response = await request(server(app)).get('/health/ready').expect(503);

    const body = readinessResponseSchema.parse(response.body);
    expect(body.status).toBe('down');
    expect(body.dependencies.find((dependency) => dependency.name === 'redis')?.status).toBe(
      'down',
    );
  });
});
