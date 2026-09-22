import { Injectable } from '@nestjs/common';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import type { DependencyProbe } from '../application/ports/dependency-probe.port.js';

@Injectable()
export class RedisProbe implements DependencyProbe {
  readonly name = 'redis';

  constructor(private readonly redis: RedisService) {}

  async check(): Promise<void> {
    // `ping` rejects when the connection cannot be established; a resolved call
    // is proof the server answered.
    await this.redis.client.ping();
  }
}
