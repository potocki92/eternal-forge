import { EQUIPMENT_SLOTS, type EquipmentSlot } from '@eternal-forge/game-core';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { OwnedItem } from '../../inventory/domain/inventory.js';
import { toOwnedItem } from '../../inventory/infrastructure/item-instance.rows.js';
import type {
  CharacterLoadout,
  CharacterStatsRepository,
} from '../application/ports/character-stats-repository.port.js';

/**
 * PostgreSQL implementation of {@link CharacterStatsRepository}.
 *
 * One owner-scoped read loads the level, the version, the (at most seven)
 * equipped instances with their rolls and, when asked, the one candidate
 * instance — by primary key and owning character. The rest of the inventory
 * is never read, and affixes are loaded per relation, never per item.
 *
 * Prisma reads each relation with its own SELECT. Outside a transaction a
 * concurrent equip could commit between them and the result would pair the
 * old version with the new equipment — a state that never existed. Combat is
 * protected from that by its version-conditional write; a query has no write,
 * so it reads inside one REPEATABLE READ transaction: every SELECT sees the
 * same snapshot, and the version always describes the loadout returned.
 */
@Injectable()
export class PrismaCharacterStatsRepository implements CharacterStatsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async loadLoadout(
    authUserId: string,
    characterId: string,
    candidateItemId: string | null,
  ): Promise<CharacterLoadout | null> {
    const row = await this.prisma.client.$transaction(
      (transaction) =>
        transaction.character.findFirst({
          where: { id: characterId, profile: { authUserId } },
          select: {
            level: true,
            version: true,
            equipment: {
              include: { itemInstance: { include: { affixes: { orderBy: { position: 'asc' } } } } },
            },
            itemInstances: {
              where: { id: { in: candidateItemId === null ? [] : [candidateItemId] } },
              include: { affixes: { orderBy: { position: 'asc' } } },
            },
          },
        }),
      { isolationLevel: 'RepeatableRead' },
    );
    if (row === null) return null;

    const equipment: Record<EquipmentSlot, OwnedItem | null> = {
      WEAPON: null,
      HELMET: null,
      CHEST: null,
      GLOVES: null,
      BOOTS: null,
      RING: null,
      AMULET: null,
    };
    for (const entry of row.equipment) {
      const slot = EQUIPMENT_SLOTS.find((candidate) => candidate === entry.slot);
      if (slot === undefined) throw new Error(`Invalid persisted equipment slot: ${entry.slot}`);
      equipment[slot] = toOwnedItem(entry.itemInstance);
    }
    const candidate = row.itemInstances[0];

    return {
      level: row.level,
      version: row.version,
      equipment: Object.freeze(equipment),
      candidate: candidate === undefined ? null : toOwnedItem(candidate),
    };
  }
}
