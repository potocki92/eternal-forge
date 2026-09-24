import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  equipItemRequestSchema,
  unequipItemRequestSchema,
  type EquipmentResponse,
  type EquipItemRequest,
  type InventoryResponse,
  type UnequipItemRequest,
} from '@eternal-forge/contracts';
import { parseEquipmentSlot } from '@eternal-forge/game-core';
import { z } from 'zod';
import type { AuthenticatedIdentity } from '../../auth/application/authenticated-identity.js';
import { CurrentIdentity } from '../../auth/presentation/current-identity.decorator.js';
import { ApiException } from '../../common/http/api-exception.js';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import {
  EquipItemUseCase,
  GetEquipmentUseCase,
  GetInventoryUseCase,
  UnequipItemUseCase,
  type MutationResult,
} from '../application/inventory.use-cases.js';
import { toEquipmentResponse, toInventoryResponse } from './inventory.mapper.js';

@Controller('player/characters/:characterId')
export class InventoryController {
  constructor(
    private readonly getInventory: GetInventoryUseCase,
    private readonly getEquipment: GetEquipmentUseCase,
    private readonly equipItem: EquipItemUseCase,
    private readonly unequipItem: UnequipItemUseCase,
  ) {}
  @Get('inventory')
  async inventory(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('characterId', new ZodValidationPipe(z.uuid())) characterId: string,
  ): Promise<InventoryResponse> {
    const result = await this.getInventory.execute(identity, characterId);
    if (result.kind === 'not-found') throw notFound();
    return toInventoryResponse(result.state);
  }
  @Get('equipment')
  async equipment(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('characterId', new ZodValidationPipe(z.uuid())) characterId: string,
  ): Promise<EquipmentResponse> {
    const result = await this.getEquipment.execute(identity, characterId);
    if (result.kind === 'not-found') throw notFound();
    return toEquipmentResponse(result.state);
  }
  @Post('equipment/equip')
  @HttpCode(HttpStatus.OK)
  async equip(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('characterId', new ZodValidationPipe(z.uuid())) characterId: string,
    @Body(new ZodValidationPipe(equipItemRequestSchema)) body: EquipItemRequest,
  ): Promise<EquipmentResponse> {
    return mutationResponse(
      await this.equipItem.execute(identity, characterId, body.itemInstanceId),
    );
  }
  @Post('equipment/unequip')
  @HttpCode(HttpStatus.OK)
  async unequip(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('characterId', new ZodValidationPipe(z.uuid())) characterId: string,
    @Body(new ZodValidationPipe(unequipItemRequestSchema)) body: UnequipItemRequest,
  ): Promise<EquipmentResponse> {
    return mutationResponse(
      await this.unequipItem.execute(identity, characterId, parseEquipmentSlot(body.slot)),
    );
  }
}
function mutationResponse(result: MutationResult): EquipmentResponse {
  if (result.kind === 'not-found') throw notFound();
  if (result.kind === 'conflict')
    throw new ApiException(
      HttpStatus.CONFLICT,
      'CONCURRENT_UPDATE',
      'Your hero was busy. Please try again.',
    );
  return toEquipmentResponse(result.state);
}
function notFound(): ApiException {
  return new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Character or item not found.');
}
