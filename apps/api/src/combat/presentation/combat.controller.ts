import { Controller, Headers, HttpStatus, Param, Post, Res } from '@nestjs/common';
import { IDEMPOTENCY_KEY_HEADER, type CombatResponse } from '@eternal-forge/contracts';
import type { Response } from 'express';
import { z } from 'zod';
import type { AuthenticatedIdentity } from '../../auth/application/authenticated-identity.js';
import { CurrentIdentity } from '../../auth/presentation/current-identity.decorator.js';
import { ApiException } from '../../common/http/api-exception.js';
import { parseIdempotencyKey } from '../../common/http/idempotency-key.js';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { RunCombatUseCase } from '../application/run-combat.use-case.js';
import { toCombatResponse } from './combat.mapper.js';

/**
 * Transport adapter for combat (ADR-019).
 *
 * The route takes a target and an idempotency key, never a gameplay value:
 * there is no request body to trust. Identity comes from the verified token.
 */
@Controller('player/characters/:characterId/combats')
export class CombatController {
  constructor(private readonly runCombat: RunCombatUseCase) {}

  /** 201 for a new combat, 200 for the replay of one already resolved under the key. */
  @Post()
  async start(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('characterId', new ZodValidationPipe(z.uuid())) characterId: string,
    @Headers(IDEMPOTENCY_KEY_HEADER.toLowerCase()) rawIdempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CombatResponse> {
    const idempotencyKey = parseIdempotencyKey(rawIdempotencyKey);
    const result = await this.runCombat.execute(identity, { characterId, idempotencyKey });

    switch (result.kind) {
      case 'not-found':
        throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Character not found.');
      case 'not-ready':
        throw new ApiException(
          HttpStatus.CONFLICT,
          'COMBAT_NOT_READY',
          'Your hero is still fighting.',
          { headers: { 'Retry-After': retryAfterSeconds(result.nextCombatAt, result.serverTime) } },
        );
      case 'stage-not-playable':
        throw new ApiException(
          HttpStatus.CONFLICT,
          'STAGE_NOT_PLAYABLE',
          'No enemy is known this deep yet. Your progress is safe.',
        );
      case 'resolved':
        response.status(result.replayed ? HttpStatus.OK : HttpStatus.CREATED);
        return toCombatResponse(result.combat, result.serverTime);
    }
  }
}

/** Whole seconds, rounded up, never below one (RFC 9110 `Retry-After`). */
function retryAfterSeconds(nextCombatAt: Date, now: Date): string {
  return String(Math.max(1, Math.ceil((nextCombatAt.getTime() - now.getTime()) / 1_000)));
}
