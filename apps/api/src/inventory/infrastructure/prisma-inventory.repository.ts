import { Injectable } from '@nestjs/common';
import {
  EQUIPMENT_SLOTS,
  ITEM_CATALOG,
  parseItemInstance,
  type EquipmentSlot,
} from '@eternal-forge/game-core';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type {
  ChangeEquipmentCommand,
  InventoryRepository,
  TrustedItemInstance,
} from '../application/ports/inventory-repository.port.js';
import type { InventoryState, OwnedItem } from '../domain/inventory.js';

@Injectable()
export class PrismaInventoryRepository implements InventoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async loadOwned(authUserId: string, characterId: string): Promise<InventoryState | null> {
    const character = await this.prisma.client.character.findFirst({
      where: { id: characterId, profile: { authUserId } },
      select: {
        version: true,
        itemInstances: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        equipment: { include: { itemInstance: true } },
      },
    });
    if (character === null) return null;
    const items = character.itemInstances.map(toOwnedItem);
    const equipment = emptyEquipment();
    for (const row of character.equipment) {
      const slot = EQUIPMENT_SLOTS.find((candidate) => candidate === row.slot);
      if (slot === undefined) throw new Error(`Invalid persisted equipment slot: ${row.slot}`);
      equipment[slot] = toOwnedItem(row.itemInstance);
    }
    return { items, equipment: Object.freeze(equipment), version: character.version };
  }

  async changeEquipment(command: ChangeEquipmentCommand): Promise<'saved' | 'conflict'> {
    return this.prisma.client.$transaction(async (transaction) => {
      const changed = await transaction.character.updateMany({
        where: {
          id: command.characterId,
          version: command.expectedVersion,
          profile: { authUserId: command.authUserId },
        },
        data: { version: { increment: 1 } },
      });
      if (changed.count !== 1) return 'conflict';
      if (command.itemInstanceId === null) {
        await transaction.characterEquipment.deleteMany({
          where: { characterId: command.characterId, slot: command.slot },
        });
      } else {
        await transaction.characterEquipment.upsert({
          where: { characterId_slot: { characterId: command.characterId, slot: command.slot } },
          create: {
            characterId: command.characterId,
            slot: command.slot,
            itemInstanceId: command.itemInstanceId,
          },
          update: { itemInstanceId: command.itemInstanceId },
        });
      }
      return 'saved';
    });
  }

  async createTrustedItem(input: TrustedItemInstance): Promise<void> {
    ITEM_CATALOG.require(input.item.definitionId);
    await this.prisma.client.itemInstance.create({
      data: {
        id: input.item.id.toString(),
        characterId: input.characterId,
        definitionId: input.item.definitionId.toString(),
        rarity: input.item.rarity,
        ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
      },
    });
  }
}

function toOwnedItem(row: {
  id: string;
  definitionId: string;
  rarity: string;
  createdAt: Date;
}): OwnedItem {
  return {
    item: parseItemInstance(
      { id: row.id, definitionId: row.definitionId, rarity: row.rarity },
      ITEM_CATALOG,
    ),
    createdAt: row.createdAt,
  };
}
function emptyEquipment(): Record<EquipmentSlot, OwnedItem | null> {
  return {
    WEAPON: null,
    HELMET: null,
    CHEST: null,
    GLOVES: null,
    BOOTS: null,
    RING: null,
    AMULET: null,
  };
}
