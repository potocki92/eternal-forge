import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { ClockModule } from './common/clock/clock.module.js';
import { ApiConfigModule } from './config/api-config.module.js';
import { RequestIdMiddleware } from './common/http/request-id.middleware.js';
import { HealthModule } from './health/health.module.js';
import { PlayerModule } from './player/player.module.js';

@Module({
  imports: [ApiConfigModule, ClockModule, AuthModule, HealthModule, PlayerModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*splat');
  }
}
