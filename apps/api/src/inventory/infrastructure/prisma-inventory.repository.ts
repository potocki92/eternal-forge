import { Injectable } from '@nestjs/common';
import { EQUIPMENT_SLOTS, ITEM_CATALOG, type EquipmentSlot } from '@eternal-forge/game-core';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type {
  ChangeEquipmentCommand,
  InventoryRepository,
  TrustedItemInstance,
} from '../application/ports/inventory-repository.port.js';
import type { InventoryState, OwnedItem } from '../domain/inventory.js';
import { toOwnedItem } from './item-instance.rows.js';

@Injectable()
export class PrismaInventoryRepository implements InventoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One owner-scoped read of the version, the owned instances, the equipment
   * and every roll.
   *
   * Prisma reads each relation with its own SELECT. Outside a transaction an
   * equip or a reward could commit between them, pairing one version with
   * another version's equipment or items — a state that never existed, under
   * a version the web uses to key equipment previews (ADR-030). The read
   * therefore runs inside one REPEATABLE READ transaction: every SELECT sees
   * the same snapshot. It writes nothing and takes no row lock; mutations
   * still rely on their version-conditional write (ADR-025).
   */
  async loadOwned(authUserId: string, characterId: string): Promise<InventoryState | null> {
    const character = await this.prisma.client.$transaction(
      (transaction) =>
        transaction.character.findFirst({
          where: { id: characterId, profile: { authUserId } },
          select: {
            version: true,
            itemInstances: {
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              include: { affixes: { orderBy: { position: 'asc' } } },
            },
            equipment: {
              include: {
                itemInstance: { include: { affixes: { orderBy: { position: 'asc' } } } },
              },
            },
          },
        }),
      { isolationLevel: 'RepeatableRead' },
    );
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
