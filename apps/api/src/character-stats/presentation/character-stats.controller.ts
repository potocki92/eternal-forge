import { Controller, Get, HttpStatus, Param, Query } from '@nestjs/common';
import {
  statsPreviewQuerySchema,
  type CharacterStatsResponse,
  type StatsPreviewQuery,
  type StatsPreviewResponse,
} from '@eternal-forge/contracts';
import { parseEquipmentSlot } from '@eternal-forge/game-core';
import { z } from 'zod';
import type { AuthenticatedIdentity } from '../../auth/application/authenticated-identity.js';
import { CurrentIdentity } from '../../auth/presentation/current-identity.decorator.js';
import { ApiException } from '../../common/http/api-exception.js';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import {
  GetCharacterStatsUseCase,
  PreviewEquipmentChangeUseCase,
} from '../application/character-stats.use-cases.js';
import { toCharacterStatsResponse, toStatsPreviewResponse } from './character-stats.mapper.js';

/**
 * Read-only character stat queries (ADR-030). Thin: validate the path and
 * query with the shared contract, call the use case, map the result. No
 * route here accepts a stat, a slot for an equip, a rarity, an affix, a seed
 * or a version, and no route writes anything.
 */
@Controller('player/characters/:characterId/stats')
export class CharacterStatsController {
  constructor(
    private readonly getStats: GetCharacterStatsUseCase,
    private readonly previewChange: PreviewEquipmentChangeUseCase,
  ) {}

  @Get()
  async stats(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('characterId', new ZodValidationPipe(z.uuid())) characterId: string,
  ): Promise<CharacterStatsResponse> {
    const result = await this.getStats.execute(identity, characterId);
    if (result.kind === 'not-found') throw notFound();
    return toCharacterStatsResponse(result.view);
  }

  @Get('preview')
  async preview(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('characterId', new ZodValidationPipe(z.uuid())) characterId: string,
    @Query(new ZodValidationPipe(statsPreviewQuerySchema)) query: StatsPreviewQuery,
  ): Promise<StatsPreviewResponse> {
    const result = await this.previewChange.execute(
      identity,
      characterId,
      'equip' in query
        ? { kind: 'EQUIP', itemInstanceId: query.equip }
        : { kind: 'UNEQUIP', slot: parseEquipmentSlot(query.unequip) },
    );
    if (result.kind === 'not-found') throw notFound();
    return toStatsPreviewResponse(result.view);
  }
}

function notFound(): ApiException {
  return new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Character or item not found.');
}
