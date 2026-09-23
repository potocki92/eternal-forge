import { Controller, Headers, HttpStatus, Param, Post, Res } from '@nestjs/common';
import { IDEMPOTENCY_KEY_HEADER, type OfflineProgressResponse } from '@eternal-forge/contracts';
import type { Response } from 'express';
import { z } from 'zod';
import type { AuthenticatedIdentity } from '../../auth/application/authenticated-identity.js';
import { CurrentIdentity } from '../../auth/presentation/current-identity.decorator.js';
import { ApiException } from '../../common/http/api-exception.js';
import { parseIdempotencyKey } from '../../common/http/idempotency-key.js';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { ClaimOfflineProgressUseCase } from '../application/claim-offline-progress.use-case.js';
import { toOfflineProgressResponse } from './offline-progress.mapper.js';

/**
 * Transport adapter for offline progression (ADR-023).
 *
 * Like combat, the route takes a target and an idempotency key and nothing
 * else: there is no request body to trust — no elapsed time, no client clock,
 * no stage, no reward. A body, if one is sent, is ignored. Identity comes from
 * the verified token.
 */
@Controller('player/characters/:characterId/offline-progress')
export class OfflineProgressController {
  constructor(private readonly claimOfflineProgress: ClaimOfflineProgressUseCase) {}

  /**
   * 201 for a newly collected claim; 200 for the replay of a claim already
   * collected under the key, and for a claim that found nothing to collect.
   */
  @Post()
  async claim(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('characterId', new ZodValidationPipe(z.uuid())) characterId: string,
    @Headers(IDEMPOTENCY_KEY_HEADER.toLowerCase()) rawIdempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OfflineProgressResponse> {
    const idempotencyKey = parseIdempotencyKey(rawIdempotencyKey);
    const result = await this.claimOfflineProgress.execute(identity, {
      characterId,
      idempotencyKey,
    });

    switch (result.kind) {
      case 'not-found':
        throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Character not found.');
      case 'conflict':
        throw new ApiException(
          HttpStatus.CONFLICT,
          'CONCURRENT_UPDATE',
          'Your hero was busy. Please try again.',
        );
      case 'collected':
      case 'replayed':
      case 'nothing':
        response.status(result.kind === 'collected' ? HttpStatus.CREATED : HttpStatus.OK);
        return toOfflineProgressResponse(result);
    }
  }
}
