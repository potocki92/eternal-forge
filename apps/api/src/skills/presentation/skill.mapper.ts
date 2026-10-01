import type { OwnedSkillDto, SkillStateResponse } from '@eternal-forge/contracts';
import { SKILL_CATALOG, SKILL_LOADOUT_MAX_SIZE, type OwnedSkill } from '@eternal-forge/game-core';
import type { SkillState } from '../domain/skill-state.js';

function toOwnedSkillDto(skill: OwnedSkill): OwnedSkillDto {
  return {
    skillId: skill.id.toString(),
    nameKey: SKILL_CATALOG.require(skill.id).nameKey,
    level: skill.level.toNumber(),
  };
}

export function toSkillStateResponse(state: SkillState): SkillStateResponse {
  return {
    characterVersion: state.version.toString(),
    maxLoadoutSize: SKILL_LOADOUT_MAX_SIZE,
    owned: state.skills.owned.map(toOwnedSkillDto),
    loadout: state.skills.loadout.map((skill, priority) => ({
      ...toOwnedSkillDto(skill),
      priority,
    })),
  };
}
