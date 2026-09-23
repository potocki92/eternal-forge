/**
 * Persistence and data-platform infrastructure.
 *
 * Nothing here is a domain entity. Application and domain code depends on
 * repository *ports*; the implementations that use this package live in each
 * application's infrastructure layer (docs/ARCHITECTURE.md).
 */
export { createPrismaClient, pingDatabase } from './prisma/prisma-client.js';
export { isUniqueConstraintViolation } from './prisma/prisma-errors.js';
export type {
  DatabaseProbeTarget,
  PrismaClient,
  PrismaClientOptions,
} from './prisma/prisma-client.js';
