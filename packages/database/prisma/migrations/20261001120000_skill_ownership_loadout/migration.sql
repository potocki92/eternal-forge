-- Phase 7 PR 7.2 — active skill ownership, levels and the ordered loadout
-- (ADR-032). Source state only: skill definitions and tuning are static Game
-- Core content and get no table. Existing characters keep zero owned skills
-- and an empty loadout; nothing is granted here.

-- One owned skill at its level. No row means not owned; there is no level 0.
-- `integer` bounds the level at 2^31 − 1, Game Core's SKILL_LEVEL_MAX.
CREATE TABLE "character_skills" (
    "character_id" UUID NOT NULL,
    "skill_definition_id" VARCHAR(64) NOT NULL,
    "level" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "character_skills_pkey" PRIMARY KEY ("character_id","skill_definition_id"),
    CONSTRAINT "character_skills_skill_definition_id_check" CHECK ("skill_definition_id" ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'),
    CONSTRAINT "character_skills_level_check" CHECK ("level" >= 1)
);

-- The ordered loadout: position 0 is the highest cast priority. The maximum
-- size is a Game Core rule (SKILL_LOADOUT_MAX_SIZE) and is deliberately not
-- repeated here; the application replaces the whole loadout in one
-- transaction, so positions are always 0 … n − 1.
CREATE TABLE "character_skill_loadout" (
    "character_id" UUID NOT NULL,
    "position" SMALLINT NOT NULL,
    "skill_definition_id" VARCHAR(64) NOT NULL,

    CONSTRAINT "character_skill_loadout_pkey" PRIMARY KEY ("character_id","position"),
    CONSTRAINT "character_skill_loadout_position_check" CHECK ("position" >= 0)
);

-- A skill is equipped at most once per character.
CREATE UNIQUE INDEX "character_skill_loadout_character_skill_key" ON "character_skill_loadout"("character_id", "skill_definition_id");

ALTER TABLE "character_skills" ADD CONSTRAINT "character_skills_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "character_skill_loadout" ADD CONSTRAINT "character_skill_loadout_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Only an owned skill can be equipped, enforced by PostgreSQL itself. NO
-- ACTION (checked at the end of the statement) refuses to delete the
-- ownership of an equipped skill, while deleting the character still
-- cascades through both tables.
ALTER TABLE "character_skill_loadout" ADD CONSTRAINT "character_skill_loadout_owned_skill_fkey" FOREIGN KEY ("character_id", "skill_definition_id") REFERENCES "character_skills"("character_id", "skill_definition_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- API-only persistence: no browser role may read or write skills directly.
ALTER TABLE "character_skills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "character_skill_loadout" ENABLE ROW LEVEL SECURITY;

-- Supabase defines these browser-facing roles, while plain PostgreSQL used by
-- local development and CI does not. Revoke each only when it exists.
DO $$
DECLARE
    api_role text;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
            EXECUTE format(
                'REVOKE ALL ON TABLE "character_skills", "character_skill_loadout" FROM %I',
                api_role
            );
        END IF;
    END LOOP;
END
$$;
