-- Stage selection and farming (ADR-021).
--
-- `characters.current_stage` already is "where the hero fights next"
-- (ADR-020); stage selection moves it within 1 … highest_stage_reached, which
-- the existing CHECKs enforce. The only new state is what a victory does to
-- it: climb on (PROGRESS, the Phase 3 behaviour) or stay (FARM).
--
-- Backfill: every existing character climbs, and every recorded combat was
-- fought while climbing, because PROGRESS was the only behaviour before this
-- migration. No other column changes and no data is lost.

CREATE TYPE "stage_mode" AS ENUM ('PROGRESS', 'FARM');

-- ---------------------------------------------------------------------------
-- characters: the player's current choice. New characters climb.
-- ---------------------------------------------------------------------------
ALTER TABLE "characters"
    ADD COLUMN "stage_mode" "stage_mode" NOT NULL DEFAULT 'PROGRESS';

-- ---------------------------------------------------------------------------
-- combat_runs: the mode a combat was fought in is a replay input, like the
-- records before it. The default only backfills existing rows; every new row
-- must state its mode, so the default is dropped afterwards.
-- ---------------------------------------------------------------------------
ALTER TABLE "combat_runs"
    ADD COLUMN "stage_mode" "stage_mode" NOT NULL DEFAULT 'PROGRESS';
ALTER TABLE "combat_runs" ALTER COLUMN "stage_mode" DROP DEFAULT;
