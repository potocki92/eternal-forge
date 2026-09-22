import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ApiConfigModule } from './config/api-config.module.js';
import { RequestIdMiddleware } from './common/http/request-id.middleware.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [ApiConfigModule, HealthModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*splat');
  }
}
