-- Stage progression model (ADR-020).
--
-- One `stage` column meant both "where the hero fights next" and "how far the
-- hero has come", so a boss defeat that sent the hero back to farm erased the
-- record. It becomes three values:
--
--   current_stage          the stage the next combat is fought on
--   highest_stage_reached  the highest stage ever unlocked (never decreases)
--   highest_stage_cleared  the highest stage ever defeated, NULL until the
--                          first clear (never decreases)
--
-- Backfill: only what the data proves (docs/DATABASE.md — "Stage progress").
-- A stage counts as cleared only if a recorded WIN on it exists in
-- combat_runs; a stage counts as reached if it is or was the current stage,
-- was fought, or follows a cleared stage. Characters that predate
-- authoritative combat therefore keep `highest_stage_cleared = NULL`, even if
-- their stage is above 1: nothing proves they cleared anything.

-- ---------------------------------------------------------------------------
-- characters
-- ---------------------------------------------------------------------------
ALTER TABLE "characters" RENAME COLUMN "stage" TO "current_stage";
ALTER TABLE "characters" RENAME CONSTRAINT "characters_stage_check" TO "characters_current_stage_check";

ALTER TABLE "characters"
    ADD COLUMN "highest_stage_reached" BIGINT,
    ADD COLUMN "highest_stage_cleared" BIGINT;

UPDATE "characters" AS c
SET "highest_stage_cleared" = proof."max_won",
    "highest_stage_reached" = GREATEST(
        c."current_stage",
        COALESCE(proof."max_fought", 1),
        COALESCE(proof."max_won" + 1, 1)
    )
FROM (
    SELECT ch."id",
           MAX(r."stage") FILTER (WHERE r."outcome" = 'WIN') AS "max_won",
           MAX(r."stage") AS "max_fought"
    FROM "characters" AS ch
    LEFT JOIN "combat_runs" AS r ON r."character_id" = ch."id"
    GROUP BY ch."id"
) AS proof
WHERE proof."id" = c."id";

ALTER TABLE "characters"
    ALTER COLUMN "highest_stage_reached" SET NOT NULL,
    ALTER COLUMN "highest_stage_reached" SET DEFAULT 1;

ALTER TABLE "characters" ADD CONSTRAINT "characters_highest_stage_reached_check"
    CHECK ("highest_stage_reached" >= 1);
ALTER TABLE "characters" ADD CONSTRAINT "characters_highest_stage_cleared_check"
    CHECK ("highest_stage_cleared" IS NULL OR "highest_stage_cleared" >= 1);
ALTER TABLE "characters" ADD CONSTRAINT "characters_current_stage_reached_check"
    CHECK ("current_stage" <= "highest_stage_reached");
ALTER TABLE "characters" ADD CONSTRAINT "characters_highest_stage_cleared_reached_check"
    CHECK ("highest_stage_cleared" IS NULL OR "highest_stage_cleared" <= "highest_stage_reached");

-- ---------------------------------------------------------------------------
-- combat_runs: the records before each combat, so a replay reproduces the
-- whole transition. `stage` stays the stage actually fought.
--
-- Backfill for rows that predate this migration: the records as that
-- character's own earlier combats prove them (the same rules as above, over
-- the runs strictly before this one).
-- ---------------------------------------------------------------------------
ALTER TABLE "combat_runs"
    ADD COLUMN "highest_stage_reached_before" BIGINT,
    ADD COLUMN "highest_stage_cleared_before" BIGINT;

UPDATE "combat_runs" AS r
SET "highest_stage_cleared_before" = history."cleared_before",
    "highest_stage_reached_before" = GREATEST(
        r."stage",
        COALESCE(history."fought_before", 1),
        COALESCE(history."cleared_before" + 1, 1)
    )
FROM (
    SELECT "id",
           MAX("stage") FILTER (WHERE "outcome" = 'WIN') OVER earlier AS "cleared_before",
           MAX("stage") OVER earlier AS "fought_before"
    FROM "combat_runs"
    WINDOW earlier AS (
        PARTITION BY "character_id"
        ORDER BY "created_at", "id"
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    )
) AS history
WHERE history."id" = r."id";

ALTER TABLE "combat_runs" ALTER COLUMN "highest_stage_reached_before" SET NOT NULL;

ALTER TABLE "combat_runs" ADD CONSTRAINT "combat_runs_stage_reached_before_check"
    CHECK ("stage" <= "highest_stage_reached_before");
ALTER TABLE "combat_runs" ADD CONSTRAINT "combat_runs_highest_stage_cleared_before_check"
    CHECK (
        "highest_stage_cleared_before" IS NULL
        OR ("highest_stage_cleared_before" >= 1
            AND "highest_stage_cleared_before" <= "highest_stage_reached_before")
    );
