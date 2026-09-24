import { Module } from '@nestjs/common';
import { PrismaModule } from '../infrastructure/prisma/prisma.module.js';
import {
  EquipItemUseCase,
  GetEquipmentUseCase,
  GetInventoryUseCase,
  UnequipItemUseCase,
} from './application/inventory.use-cases.js';
import { INVENTORY_REPOSITORY } from './application/ports/inventory-repository.port.js';
import { PrismaInventoryRepository } from './infrastructure/prisma-inventory.repository.js';
import { InventoryController } from './presentation/inventory.controller.js';
@Module({
  imports: [PrismaModule],
  controllers: [InventoryController],
  providers: [
    { provide: INVENTORY_REPOSITORY, useClass: PrismaInventoryRepository },
    GetInventoryUseCase,
    GetEquipmentUseCase,
    EquipItemUseCase,
    UnequipItemUseCase,
  ],
})
export class InventoryModule {}
