import { Injectable } from '@nestjs/common';
import { pingDatabase } from '@eternal-forge/database';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { DependencyProbe } from '../application/ports/dependency-probe.port.js';

@Injectable()
export class DatabaseProbe implements DependencyProbe {
  readonly name = 'postgres';

  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<void> {
    await pingDatabase(this.prisma.client);
  }
}
