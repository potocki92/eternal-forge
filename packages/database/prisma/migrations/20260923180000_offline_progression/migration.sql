-- Offline progression (ADR-023).
--
-- The processed boundary of a character's time already exists:
-- `characters.next_combat_at` is the instant up to which every moment is
-- accounted for by a fight (ADR-019 §10). Offline progression converts idle
-- time after it into farming fights and moves it forward, so no new timestamp
-- column is needed on `characters`.
--
-- New state:
--
-- * `characters.offline_seed` — the server-held seed of the character's next
--   offline claim. A claim that fights nothing writes nothing, so without a
--   stored seed a client could ask again and again until a lucky draw fits
--   one more fight. The seed is fixed until a claim commits, and every
--   committed claim replaces it with a fresh one from the API's CSPRNG.
--   Existing and new rows get an initial seed from PostgreSQL's strong
--   random source through `gen_random_uuid()` (two UUIDs, 244 random bits).
--
-- * `offline_runs` — one row per claim that fought: the replay inputs and the
--   audited summary. It is the ledger entry for the claim's gold and
--   experience, as `combat_runs` is for a single combat.
--
-- No existing column or row changes.

-- ---------------------------------------------------------------------------
-- characters: the next offline claim's seed.
-- ---------------------------------------------------------------------------
ALTER TABLE "characters" ADD COLUMN "offline_seed" VARCHAR(64) NOT NULL DEFAULT (replace((gen_random_uuid())::text, '-'::text, ''::text) || replace((gen_random_uuid())::text, '-'::text, ''::text));
ALTER TABLE "characters" ADD CONSTRAINT "characters_offline_seed_check" CHECK (char_length("offline_seed") >= 1);

-- ---------------------------------------------------------------------------
-- offline_runs
-- ---------------------------------------------------------------------------
CREATE TABLE "offline_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "character_id" UUID NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "rules_version" INTEGER NOT NULL,
    "seed" VARCHAR(64) NOT NULL,
    "idle_since" TIMESTAMPTZ(3) NOT NULL,
    "rewarded_from" TIMESTAMPTZ(3) NOT NULL,
    "processed_until" TIMESTAMPTZ(3) NOT NULL,
    "current_stage" BIGINT NOT NULL,
    "highest_stage_reached" BIGINT NOT NULL,
    "highest_stage_cleared" BIGINT NOT NULL,
    "character_level" INTEGER NOT NULL,
    "experience_before_coef" BIGINT NOT NULL,
    "experience_before_exp" INTEGER NOT NULL,
    "gold_before_coef" BIGINT NOT NULL,
    "gold_before_exp" INTEGER NOT NULL,
    "target_stage" BIGINT NOT NULL,
    "fights" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL,
    "losses" INTEGER NOT NULL,
    "levels_gained" INTEGER NOT NULL,
    "reward_gold_coef" BIGINT NOT NULL,
    "reward_gold_exp" INTEGER NOT NULL,
    "reward_experience_coef" BIGINT NOT NULL,
    "reward_experience_exp" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offline_runs_pkey" PRIMARY KEY ("id")
);

-- The only index: it serves the idempotency lookup, the per-character history
-- and the cascading delete, like the one on combat_runs.
CREATE UNIQUE INDEX "offline_runs_character_id_idempotency_key_key" ON "offline_runs"("character_id", "idempotency_key");

ALTER TABLE "offline_runs" ADD CONSTRAINT "offline_runs_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Integrity rules Prisma cannot express (docs/DATABASE.md — "Constraints").
-- ---------------------------------------------------------------------------
ALTER TABLE "offline_runs" ADD CONSTRAINT "offline_runs_rules_version_check" CHECK ("rules_version" >= 1);
ALTER TABLE "offline_runs" ADD CONSTRAINT "offline_runs_seed_check" CHECK (char_length("seed") >= 1);

-- The time line of a claim runs forwards: idle since → rewarded from →
-- processed until → the claim itself. A claim can never account for time
-- after it was made, nor reach back before the boundary it started from.
ALTER TABLE "offline_runs" ADD CONSTRAINT "offline_runs_time_check" CHECK (
    "idle_since" <= "rewarded_from"
    AND "rewarded_from" < "processed_until"
    AND "processed_until" <= "created_at"
);

-- Stage progress at the claim (ADR-020 invariants). A claim needs a cleared
-- stage, and the stage farmed is never above the record: offline progression
-- cannot fight, let alone clear, a stage that has not been beaten.
ALTER TABLE "offline_runs" ADD CONSTRAINT "offline_runs_stage_progress_check" CHECK (
    "current_stage" >= 1
    AND "current_stage" <= "highest_stage_reached"
    AND "highest_stage_cleared" >= 1
    AND "highest_stage_cleared" <= "highest_stage_reached"
);
ALTER TABLE "offline_runs" ADD CONSTRAINT "offline_runs_target_stage_check" CHECK (
    "target_stage" >= 1 AND "target_stage" <= "highest_stage_cleared"
);

-- Counts: a row exists only for a claim that fought, and every fight is a win
-- or a loss. A claim without a win pays nothing, in the ledger itself.
ALTER TABLE "offline_runs" ADD CONSTRAINT "offline_runs_counts_check" CHECK (
    "fights" >= 1 AND "wins" >= 0 AND "losses" >= 0 AND "wins" + "losses" = "fights"
);
ALTER TABLE "offline_runs" ADD CONSTRAINT "offline_runs_character_level_check" CHECK ("character_level" >= 1);
ALTER TABLE "offline_runs" ADD CONSTRAINT "offline_runs_levels_gained_check" CHECK ("levels_gained" >= 0);
ALTER TABLE "offline_runs" ADD CONSTRAINT "offline_runs_no_win_reward_check" CHECK (
    "wins" > 0 OR ("reward_gold_coef" = 0 AND "reward_experience_coef" = 0 AND "levels_gained" = 0)
);

-- HugeNumber pairs (ADR-013), as on combat_runs: normalised, non-negative and
-- whole.
ALTER TABLE "offline_runs" ADD CONSTRAINT "offline_runs_experience_before_check" CHECK (
    ("experience_before_coef" = 0 AND "experience_before_exp" = -2147483648)
    OR ("experience_before_coef" BETWEEN 100000000000000000 AND 999999999999999999 AND "experience_before_exp" > -2147483648)
);
ALTER TABLE "offline_runs" ADD CONSTRAINT "offline_runs_experience_before_whole_check" CHECK (
    CASE
        WHEN "experience_before_coef" = 0 OR "experience_before_exp" >= 17 THEN true
        WHEN "experience_before_exp" < 0 THEN false
        ELSE "experience_before_coef" % (10::numeric ^ (17 - "experience_before_exp"))::bigint = 0
    END
);
ALTER TABLE "offline_runs" ADD CONSTRAINT "offline_runs_gold_before_check" CHECK (
    ("gold_before_coef" = 0 AND "gold_before_exp" = -2147483648)
    OR ("gold_before_coef" BETWEEN 100000000000000000 AND 999999999999999999 AND "gold_before_exp" > -2147483648)
);
ALTER TABLE "offline_runs" ADD CONSTRAINT "offline_runs_gold_before_whole_check" CHECK (
    CASE
        WHEN "gold_before_coef" = 0 OR "gold_before_exp" >= 17 THEN true
        WHEN "gold_before_exp" < 0 THEN false
        ELSE "gold_before_coef" % (10::numeric ^ (17 - "gold_before_exp"))::bigint = 0
    END
);
ALTER TABLE "offline_runs" ADD CONSTRAINT "offline_runs_reward_gold_check" CHECK (
    ("reward_gold_coef" = 0 AND "reward_gold_exp" = -2147483648)
    OR ("reward_gold_coef" BETWEEN 100000000000000000 AND 999999999999999999 AND "reward_gold_exp" > -2147483648)
);
ALTER TABLE "offline_runs" ADD CONSTRAINT "offline_runs_reward_gold_whole_check" CHECK (
    CASE
        WHEN "reward_gold_coef" = 0 OR "reward_gold_exp" >= 17 THEN true
        WHEN "reward_gold_exp" < 0 THEN false
        ELSE "reward_gold_coef" % (10::numeric ^ (17 - "reward_gold_exp"))::bigint = 0
    END
);
ALTER TABLE "offline_runs" ADD CONSTRAINT "offline_runs_reward_experience_check" CHECK (
    ("reward_experience_coef" = 0 AND "reward_experience_exp" = -2147483648)
    OR ("reward_experience_coef" BETWEEN 100000000000000000 AND 999999999999999999 AND "reward_experience_exp" > -2147483648)
);
ALTER TABLE "offline_runs" ADD CONSTRAINT "offline_runs_reward_experience_whole_check" CHECK (
    CASE
        WHEN "reward_experience_coef" = 0 OR "reward_experience_exp" >= 17 THEN true
        WHEN "reward_experience_exp" < 0 THEN false
        ELSE "reward_experience_coef" % (10::numeric ^ (17 - "reward_experience_exp"))::bigint = 0
    END
);

-- ---------------------------------------------------------------------------
-- Row Level Security: deny by default, as for every game table
-- (docs/SECURITY.md — "Supabase"). No policies: only the owning role, which
-- the API connects as, reads or writes offline history.
-- ---------------------------------------------------------------------------
ALTER TABLE "offline_runs" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    api_role text;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
            EXECUTE format('REVOKE ALL ON TABLE "offline_runs" FROM %I', api_role);
        END IF;
    END LOOP;
END
$$;
