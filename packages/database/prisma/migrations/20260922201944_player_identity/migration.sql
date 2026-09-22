-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "auth_user_id" UUID NOT NULL,
    "display_name" VARCHAR(24) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "characters" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profile_id" UUID NOT NULL,
    "slot" SMALLINT NOT NULL,
    "name" VARCHAR(24) NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "stage" BIGINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "characters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "profiles_auth_user_id_key" ON "profiles"("auth_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "characters_profile_id_slot_key" ON "characters"("profile_id", "slot");

-- AddForeignKey
ALTER TABLE "characters" ADD CONSTRAINT "characters_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Integrity rules Prisma cannot express. Application validation does not
-- replace database integrity (docs/DATABASE.md — "Constraints").
-- ---------------------------------------------------------------------------

-- Lengths are counted in characters (code points), matching the shared name
-- rule in @eternal-forge/contracts. Whitespace-only or padded names cannot be
-- stored even if a future code path skips normalisation.
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_display_name_check"
    CHECK (char_length("display_name") BETWEEN 3 AND 24 AND "display_name" = btrim("display_name"));

ALTER TABLE "characters" ADD CONSTRAINT "characters_name_check"
    CHECK (char_length("name") BETWEEN 3 AND 24 AND "name" = btrim("name"));
ALTER TABLE "characters" ADD CONSTRAINT "characters_slot_check" CHECK ("slot" >= 1);
ALTER TABLE "characters" ADD CONSTRAINT "characters_level_check" CHECK ("level" >= 1);
ALTER TABLE "characters" ADD CONSTRAINT "characters_stage_check" CHECK ("stage" >= 1);

-- ---------------------------------------------------------------------------
-- Row Level Security: deny by default (docs/SECURITY.md — "Supabase").
--
-- No policies are created, so any role that does not own the tables — on
-- Supabase that includes `anon` and `authenticated`, which PostgREST exposes to
-- browsers — sees and changes nothing. The API connects as the table owner and
-- is unaffected; backend authorization remains the control that enforces
-- ownership. RLS here is defense-in-depth for a direct path that must not exist.
-- ---------------------------------------------------------------------------
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "characters" ENABLE ROW LEVEL SECURITY;

-- On Supabase, also withdraw the default table privileges from the API roles.
-- The roles do not exist on a plain PostgreSQL (local, CI), hence the guard.
DO $$
DECLARE
    api_role text;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
            EXECUTE format('REVOKE ALL ON TABLE "profiles", "characters" FROM %I', api_role);
        END IF;
    END LOOP;
END
$$;
