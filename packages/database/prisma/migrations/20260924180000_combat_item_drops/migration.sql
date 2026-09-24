-- Phase 5 PR 5.3: one online combat reward may mint at most one item.
ALTER TABLE "item_instances" ADD COLUMN "combat_run_id" UUID;

CREATE UNIQUE INDEX "item_instances_combat_run_id_key"
ON "item_instances"("combat_run_id");

CREATE UNIQUE INDEX "item_instances_combat_run_character_key"
ON "item_instances"("combat_run_id", "character_id");

CREATE UNIQUE INDEX "combat_runs_id_character_id_key"
ON "combat_runs"("id", "character_id");

ALTER TABLE "item_instances"
ADD CONSTRAINT "item_instances_combat_reward_owner_fkey"
FOREIGN KEY ("combat_run_id", "character_id") REFERENCES "combat_runs"("id", "character_id")
ON DELETE CASCADE ON UPDATE CASCADE;
