import { Body, Controller, Get, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';
import {
  setSkillLoadoutRequestSchema,
  type SetSkillLoadoutRequest,
  type SkillStateResponse,
} from '@eternal-forge/contracts';
import { z } from 'zod';
import type { AuthenticatedIdentity } from '../../auth/application/authenticated-identity.js';
import { CurrentIdentity } from '../../auth/presentation/current-identity.decorator.js';
import { ApiException } from '../../common/http/api-exception.js';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import {
  GetSkillStateUseCase,
  SetSkillLoadoutUseCase,
  type InvalidLoadoutReason,
  type SetSkillLoadoutResult,
} from '../application/skill.use-cases.js';
import { toSkillStateResponse } from './skill.mapper.js';

const INVALID_LOADOUT_MESSAGES: Readonly<Record<InvalidLoadoutReason, string>> = {
  MALFORMED_ID: 'The request is invalid.',
  UNKNOWN_SKILL: 'That skill does not exist.',
  TOO_LARGE: 'Too many skills for one loadout.',
  DUPLICATE: 'A skill can be equipped only once.',
};

/**
 * Active skill state (ADR-032). Thin: validate with the shared contract, call
 * the use case, map the result.
 *
 * The only player-facing write is the loadout. It is a `PUT` of the ordered
 * skill identities — set semantics, so repeating it leaves the same state.
 * No route grants, removes or levels a skill: acquisition and levelling are
 * not designed yet.
 */
@Controller('player/characters/:characterId/skills')
export class SkillController {
  constructor(
    private readonly getSkillState: GetSkillStateUseCase,
    private readonly setSkillLoadout: SetSkillLoadoutUseCase,
  ) {}

  @Get()
  async state(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('characterId', new ZodValidationPipe(z.uuid())) characterId: string,
  ): Promise<SkillStateResponse> {
    const result = await this.getSkillState.execute(identity, characterId);
    if (result.kind === 'not-found') throw notFound();
    return toSkillStateResponse(result.state);
  }

  @Put('loadout')
  @HttpCode(HttpStatus.OK)
  async loadout(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('characterId', new ZodValidationPipe(z.uuid())) characterId: string,
    @Body(new ZodValidationPipe(setSkillLoadoutRequestSchema)) body: SetSkillLoadoutRequest,
  ): Promise<SkillStateResponse> {
    return loadoutResponse(
      await this.setSkillLoadout.execute(identity, characterId, body.skillIds),
    );
  }
}

function loadoutResponse(result: SetSkillLoadoutResult): SkillStateResponse {
  switch (result.kind) {
    case 'found':
      return toSkillStateResponse(result.state);
    case 'not-found':
      throw notFound();
    case 'invalid':
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        INVALID_LOADOUT_MESSAGES[result.reason],
      );
    case 'not-owned':
      throw new ApiException(
        HttpStatus.CONFLICT,
        'SKILL_NOT_OWNED',
        'Your hero does not own one of those skills.',
      );
    case 'conflict':
      throw new ApiException(
        HttpStatus.CONFLICT,
        'CONCURRENT_UPDATE',
        'Your hero was busy. Please try again.',
      );
  }
}

function notFound(): ApiException {
  return new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Character not found.');
}
