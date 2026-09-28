-- Phase 6.3: immutable player combat-stat snapshots (ADR-029).
-- Nullable as a complete group so existing V1/V2 combat history remains
-- truthful: those rows replay from their historical level-only derivation.
ALTER TABLE "combat_runs"
  ADD COLUMN "player_max_health_coef" BIGINT,
  ADD COLUMN "player_max_health_exp" INTEGER,
  ADD COLUMN "player_damage_coef" BIGINT,
  ADD COLUMN "player_damage_exp" INTEGER,
  ADD COLUMN "player_attack_speed_bp" INTEGER,
  ADD COLUMN "player_crit_chance_bp" INTEGER,
  ADD COLUMN "player_crit_damage_bp" INTEGER;

ALTER TABLE "combat_runs" ADD CONSTRAINT "combat_runs_player_stats_snapshot_check" CHECK (
  (
    "player_max_health_coef" IS NULL AND "player_max_health_exp" IS NULL AND
    "player_damage_coef" IS NULL AND "player_damage_exp" IS NULL AND
    "player_attack_speed_bp" IS NULL AND "player_crit_chance_bp" IS NULL AND
    "player_crit_damage_bp" IS NULL
  ) OR (
    "player_max_health_coef" IS NOT NULL AND "player_max_health_exp" IS NOT NULL AND
    "player_damage_coef" IS NOT NULL AND "player_damage_exp" IS NOT NULL AND
    "player_attack_speed_bp" IS NOT NULL AND "player_crit_chance_bp" IS NOT NULL AND
    "player_crit_damage_bp" IS NOT NULL AND
    "player_max_health_coef" BETWEEN 100000000000000000 AND 999999999999999999 AND
    "player_max_health_exp" > -2147483648 AND
    (
      ("player_damage_coef" = 0 AND "player_damage_exp" = -2147483648) OR
      ("player_damage_coef" BETWEEN 100000000000000000 AND 999999999999999999 AND
       "player_damage_exp" > -2147483648)
    ) AND
    "player_attack_speed_bp" >= 1 AND
    "player_crit_chance_bp" BETWEEN 0 AND 10000 AND
    "player_crit_damage_bp" >= 10000
  )
);

ALTER TABLE "combat_runs" ADD CONSTRAINT "combat_runs_v3_player_stats_check" CHECK (
  "rules_version" < 3 OR "player_max_health_coef" IS NOT NULL
);
