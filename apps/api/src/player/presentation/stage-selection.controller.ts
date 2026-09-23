import { Body, Controller, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';
import {
  stageSelectionRequestSchema,
  type StageSelectionRequest,
  type StageSelectionResponse,
} from '@eternal-forge/contracts';
import { StageNumber, type StageSelection } from '@eternal-forge/game-core';
import { z } from 'zod';
import type { AuthenticatedIdentity } from '../../auth/application/authenticated-identity.js';
import { CurrentIdentity } from '../../auth/presentation/current-identity.decorator.js';
import { ApiException } from '../../common/http/api-exception.js';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { SelectStageUseCase } from '../application/select-stage.use-case.js';
import { toCharacterDto, toProgressionDto } from './player.mapper.js';

/**
 * Transport adapter for stage selection (ADR-021).
 *
 * `PUT` because the request sets the character's selection to a value:
 * repeating it leaves the same state. The body is the player's intent only;
 * whether the stage is unlocked is decided by Game Core against the
 * character's persisted records.
 */
@Controller('player/characters/:characterId/stage-selection')
export class StageSelectionController {
  constructor(private readonly selectStage: SelectStageUseCase) {}

  @Put()
  @HttpCode(HttpStatus.OK)
  async select(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('characterId', new ZodValidationPipe(z.uuid())) characterId: string,
    @Body(new ZodValidationPipe(stageSelectionRequestSchema)) body: StageSelectionRequest,
  ): Promise<StageSelectionResponse> {
    const result = await this.selectStage.execute(identity, {
      characterId,
      selection: toSelection(body),
    });

    switch (result.kind) {
      case 'not-found':
        throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Character not found.');
      case 'stage-locked':
        throw new ApiException(
          HttpStatus.CONFLICT,
          'STAGE_LOCKED',
          `Your hero has not reached that stage yet. Stages 1 to ${result.highestStageReached.toString()} are open.`,
        );
      case 'conflict':
        throw new ApiException(
          HttpStatus.CONFLICT,
          'CONCURRENT_UPDATE',
          'Your hero was busy. Please try again.',
        );
      case 'selected':
        return {
          character: toCharacterDto(result.character),
          progression: toProgressionDto(result.progression),
          serverTime: result.serverTime.toISOString(),
        };
    }
  }
}

/** The contract already accepted only a canonical stage, so parsing is exact. */
function toSelection(body: StageSelectionRequest): StageSelection {
  return body.mode === 'FARM'
    ? { mode: 'FARM', stage: StageNumber.parse(body.stage) }
    : { mode: 'PROGRESS' };
}
