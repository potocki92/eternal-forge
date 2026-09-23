import { Body, Controller, Get, HttpStatus, Param, Post, Res } from '@nestjs/common';
import {
  provisionPlayerRequestSchema,
  type CharacterResponse,
  type PlayerStateResponse,
} from '@eternal-forge/contracts';
import type { Response } from 'express';
import { z } from 'zod';
import type { AuthenticatedIdentity } from '../../auth/application/authenticated-identity.js';
import { CurrentIdentity } from '../../auth/presentation/current-identity.decorator.js';
import { ApiException } from '../../common/http/api-exception.js';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { GetOwnedCharacterUseCase } from '../application/get-owned-character.use-case.js';
import { GetPlayerStateUseCase } from '../application/get-player-state.use-case.js';
import { ProvisionPlayerUseCase } from '../application/provision-player.use-case.js';
import { InvalidPlayerNameError } from '../domain/player-name.js';
import { toCharacterDto, toPlayerStateResponse } from './player.mapper.js';

type ProvisionPlayerBody = z.output<typeof provisionPlayerRequestSchema>;

/**
 * Transport adapter for the player use cases.
 *
 * Every route acts on the caller identified by the verified access token. No
 * route accepts a player, profile or auth-user id from the client
 * (docs/SECURITY.md — "Authentication").
 */
@Controller('player')
export class PlayerController {
  constructor(
    private readonly getPlayerState: GetPlayerStateUseCase,
    private readonly provisionPlayer: ProvisionPlayerUseCase,
    private readonly getOwnedCharacter: GetOwnedCharacterUseCase,
  ) {}

  @Get('state')
  async getState(@CurrentIdentity() identity: AuthenticatedIdentity): Promise<PlayerStateResponse> {
    const result = await this.getPlayerState.execute(identity);

    if (result.kind === 'not-provisioned') {
      throw notProvisioned();
    }

    return toPlayerStateResponse(result.player, result.progression, result.serverTime);
  }

  /** Idempotent: 201 when this request created the player, 200 when it already existed. */
  @Post()
  async provision(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Body(new ZodValidationPipe(provisionPlayerRequestSchema)) body: ProvisionPlayerBody,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PlayerStateResponse> {
    try {
      const result = await this.provisionPlayer.execute(identity, body);

      response.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);

      return toPlayerStateResponse(result.player, result.progression, result.serverTime);
    } catch (error) {
      if (error instanceof InvalidPlayerNameError) {
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_FAILED',
          'The request is invalid.',
          {
            issues: [{ path: '', message: error.problem }],
          },
        );
      }
      throw error;
    }
  }

  @Get('characters/:characterId')
  async getCharacter(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('characterId', new ZodValidationPipe(z.uuid())) characterId: string,
  ): Promise<CharacterResponse> {
    const character = await this.getOwnedCharacter.execute(identity, characterId);

    if (character === null) {
      throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Character not found.');
    }

    return { character: toCharacterDto(character) };
  }
}

function notProvisioned(): ApiException {
  return new ApiException(
    HttpStatus.NOT_FOUND,
    'PLAYER_NOT_PROVISIONED',
    'No player exists for this account yet.',
  );
}
