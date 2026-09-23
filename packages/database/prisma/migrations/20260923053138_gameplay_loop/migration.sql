-- CreateEnum
CREATE TYPE "combat_outcome" AS ENUM ('WIN', 'LOSS');

-- CreateEnum
CREATE TYPE "combat_end_reason" AS ENUM ('ENEMY_DEFEATED', 'PLAYER_DEFEATED', 'TIME_LIMIT');

-- AlterTable
ALTER TABLE "characters" ADD COLUMN     "experience_coef" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "experience_exp" INTEGER NOT NULL DEFAULT -2147483648,
ADD COLUMN     "gold_coef" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "gold_exp" INTEGER NOT NULL DEFAULT -2147483648,
ADD COLUMN     "next_combat_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "version" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "combat_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "character_id" UUID NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "rules_version" INTEGER NOT NULL,
    "seed" VARCHAR(64) NOT NULL,
    "stage" BIGINT NOT NULL,
    "character_level" INTEGER NOT NULL,
    "experience_before_coef" BIGINT NOT NULL,
    "experience_before_exp" INTEGER NOT NULL,
    "gold_before_coef" BIGINT NOT NULL,
    "gold_before_exp" INTEGER NOT NULL,
    "outcome" "combat_outcome" NOT NULL,
    "end_reason" "combat_end_reason" NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "reward_gold_coef" BIGINT NOT NULL,
    "reward_gold_exp" INTEGER NOT NULL,
    "reward_experience_coef" BIGINT NOT NULL,
    "reward_experience_exp" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "combat_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "combat_runs_character_id_idempotency_key_key" ON "combat_runs"("character_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "combat_runs" ADD CONSTRAINT "combat_runs_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Integrity rules Prisma cannot express (docs/DATABASE.md — "Constraints").
--
-- HugeNumber pairs (ADR-013): the value is coef × 10^(exp − 17). `*_check` is
-- ADR-013's normalisation rule — zero is (0, −2^31), anything else has an
-- 18-digit non-negative coefficient — so negative gold or experience cannot be
-- stored. `*_whole_check` rejects fractions: every persisted quantity in this
-- migration is a whole amount. CASE fixes the evaluation order, so the power of
-- ten is only computed where it fits a bigint (0 ≤ exp < 17).
-- ---------------------------------------------------------------------------
ALTER TABLE "characters" ADD CONSTRAINT "characters_experience_check" CHECK (
    ("experience_coef" = 0 AND "experience_exp" = -2147483648)
    OR ("experience_coef" BETWEEN 100000000000000000 AND 999999999999999999 AND "experience_exp" > -2147483648)
);
ALTER TABLE "characters" ADD CONSTRAINT "characters_experience_whole_check" CHECK (
    CASE
        WHEN "experience_coef" = 0 OR "experience_exp" >= 17 THEN true
        WHEN "experience_exp" < 0 THEN false
        ELSE "experience_coef" % (10::numeric ^ (17 - "experience_exp"))::bigint = 0
    END
);
ALTER TABLE "characters" ADD CONSTRAINT "characters_gold_check" CHECK (
    ("gold_coef" = 0 AND "gold_exp" = -2147483648)
    OR ("gold_coef" BETWEEN 100000000000000000 AND 999999999999999999 AND "gold_exp" > -2147483648)
);
ALTER TABLE "characters" ADD CONSTRAINT "characters_gold_whole_check" CHECK (
    CASE
        WHEN "gold_coef" = 0 OR "gold_exp" >= 17 THEN true
        WHEN "gold_exp" < 0 THEN false
        ELSE "gold_coef" % (10::numeric ^ (17 - "gold_exp"))::bigint = 0
    END
);
ALTER TABLE "characters" ADD CONSTRAINT "characters_version_check" CHECK ("version" >= 0);

ALTER TABLE "combat_runs" ADD CONSTRAINT "combat_runs_experience_before_check" CHECK (
    ("experience_before_coef" = 0 AND "experience_before_exp" = -2147483648)
    OR ("experience_before_coef" BETWEEN 100000000000000000 AND 999999999999999999 AND "experience_before_exp" > -2147483648)
);
ALTER TABLE "combat_runs" ADD CONSTRAINT "combat_runs_experience_before_whole_check" CHECK (
    CASE
        WHEN "experience_before_coef" = 0 OR "experience_before_exp" >= 17 THEN true
        WHEN "experience_before_exp" < 0 THEN false
        ELSE "experience_before_coef" % (10::numeric ^ (17 - "experience_before_exp"))::bigint = 0
    END
);
ALTER TABLE "combat_runs" ADD CONSTRAINT "combat_runs_gold_before_check" CHECK (
    ("gold_before_coef" = 0 AND "gold_before_exp" = -2147483648)
    OR ("gold_before_coef" BETWEEN 100000000000000000 AND 999999999999999999 AND "gold_before_exp" > -2147483648)
);
ALTER TABLE "combat_runs" ADD CONSTRAINT "combat_runs_gold_before_whole_check" CHECK (
    CASE
        WHEN "gold_before_coef" = 0 OR "gold_before_exp" >= 17 THEN true
        WHEN "gold_before_exp" < 0 THEN false
        ELSE "gold_before_coef" % (10::numeric ^ (17 - "gold_before_exp"))::bigint = 0
    END
);
ALTER TABLE "combat_runs" ADD CONSTRAINT "combat_runs_reward_gold_check" CHECK (
    ("reward_gold_coef" = 0 AND "reward_gold_exp" = -2147483648)
    OR ("reward_gold_coef" BETWEEN 100000000000000000 AND 999999999999999999 AND "reward_gold_exp" > -2147483648)
);
ALTER TABLE "combat_runs" ADD CONSTRAINT "combat_runs_reward_gold_whole_check" CHECK (
    CASE
        WHEN "reward_gold_coef" = 0 OR "reward_gold_exp" >= 17 THEN true
        WHEN "reward_gold_exp" < 0 THEN false
        ELSE "reward_gold_coef" % (10::numeric ^ (17 - "reward_gold_exp"))::bigint = 0
    END
);
ALTER TABLE "combat_runs" ADD CONSTRAINT "combat_runs_reward_experience_check" CHECK (
    ("reward_experience_coef" = 0 AND "reward_experience_exp" = -2147483648)
    OR ("reward_experience_coef" BETWEEN 100000000000000000 AND 999999999999999999 AND "reward_experience_exp" > -2147483648)
);
ALTER TABLE "combat_runs" ADD CONSTRAINT "combat_runs_reward_experience_whole_check" CHECK (
    CASE
        WHEN "reward_experience_coef" = 0 OR "reward_experience_exp" >= 17 THEN true
        WHEN "reward_experience_exp" < 0 THEN false
        ELSE "reward_experience_coef" % (10::numeric ^ (17 - "reward_experience_exp"))::bigint = 0
    END
);
ALTER TABLE "combat_runs" ADD CONSTRAINT "combat_runs_rules_version_check" CHECK ("rules_version" >= 1);
ALTER TABLE "combat_runs" ADD CONSTRAINT "combat_runs_seed_check" CHECK (char_length("seed") >= 1);
ALTER TABLE "combat_runs" ADD CONSTRAINT "combat_runs_stage_check" CHECK ("stage" >= 1);
ALTER TABLE "combat_runs" ADD CONSTRAINT "combat_runs_character_level_check" CHECK ("character_level" >= 1);
ALTER TABLE "combat_runs" ADD CONSTRAINT "combat_runs_duration_ms_check" CHECK ("duration_ms" >= 0);

-- A win ends because the enemy fell, and a loss never pays: the "no reward on
-- defeat" rule holds in the ledger itself, whatever code path wrote the row.
ALTER TABLE "combat_runs" ADD CONSTRAINT "combat_runs_outcome_check" CHECK (
    ("outcome" = 'WIN') = ("end_reason" = 'ENEMY_DEFEATED')
);
ALTER TABLE "combat_runs" ADD CONSTRAINT "combat_runs_loss_reward_check" CHECK (
    "outcome" = 'WIN' OR ("reward_gold_coef" = 0 AND "reward_experience_coef" = 0)
);

-- ---------------------------------------------------------------------------
-- Row Level Security: deny by default, as for the Phase 2 tables
-- (docs/SECURITY.md — "Supabase"). No policies: only the owning role, which
-- the API connects as, reads or writes combat history.
-- ---------------------------------------------------------------------------
ALTER TABLE "combat_runs" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    api_role text;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
            EXECUTE format('REVOKE ALL ON TABLE "combat_runs" FROM %I', api_role);
        END IF;
    END LOOP;
END
$$;
