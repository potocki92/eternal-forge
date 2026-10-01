import { Module } from '@nestjs/common';
import { PrismaModule } from '../infrastructure/prisma/prisma.module.js';
import { SKILL_REPOSITORY } from './application/ports/skill-repository.port.js';
import { GetSkillStateUseCase, SetSkillLoadoutUseCase } from './application/skill.use-cases.js';
import { PrismaSkillRepository } from './infrastructure/prisma-skill.repository.js';
import { SkillController } from './presentation/skill.controller.js';

/** Active skill ownership, levels and the ordered loadout (ADR-032). */
@Module({
  imports: [PrismaModule],
  controllers: [SkillController],
  providers: [
    { provide: SKILL_REPOSITORY, useClass: PrismaSkillRepository },
    GetSkillStateUseCase,
    SetSkillLoadoutUseCase,
  ],
})
export class SkillsModule {}
