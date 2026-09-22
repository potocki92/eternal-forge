import { Module } from '@nestjs/common';
import { PrismaModule } from '../infrastructure/prisma/prisma.module.js';
import { RedisModule } from '../infrastructure/redis/redis.module.js';
import { LivenessService } from './application/liveness.service.js';
import { ReadinessService } from './application/readiness.service.js';
import { CLOCK, systemClock } from './application/ports/clock.port.js';
import { DEPENDENCY_PROBES } from './application/ports/dependency-probe.port.js';
import { DatabaseProbe } from './infrastructure/database.probe.js';
import { RedisProbe } from './infrastructure/redis.probe.js';
import { HealthController } from './presentation/health.controller.js';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [HealthController],
  providers: [
    { provide: CLOCK, useValue: systemClock },
    DatabaseProbe,
    RedisProbe,
    {
      provide: DEPENDENCY_PROBES,
      useFactory: (database: DatabaseProbe, redis: RedisProbe) => [database, redis],
      inject: [DatabaseProbe, RedisProbe],
    },
    LivenessService,
    ReadinessService,
  ],
})
export class HealthModule {}
