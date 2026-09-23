-- ---------------------------------------------------------------------------
-- Supabase hardening for Prisma-owned tables.
--
-- Prisma creates `_prisma_migrations` before applying the project's first
-- migration. Hosted Supabase projects grant default table privileges to the
-- browser-facing `anon` and `authenticated` roles, so the technical migration
-- ledger must be hardened explicitly just like the gameplay tables.
--
-- Supabase also grants those roles privileges on future tables created by the
-- `postgres` role unless its default privileges are changed. Eternal Forge is
-- server-authoritative and does not expose gameplay tables directly through
-- PostgREST, so Prisma-owned future tables should start deny-by-default too.
--
-- The table owner (`postgres`, used by Prisma Migrate) remains able to read and
-- write `_prisma_migrations` because ordinary RLS does not constrain the owner
-- unless FORCE ROW LEVEL SECURITY is enabled.
-- ---------------------------------------------------------------------------

ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;

-- Supabase defines these roles; plain PostgreSQL used by local development and
-- CI does not necessarily do so. Guard both the current-table revocation and
-- the default-privilege hardening so the migration remains portable across all
-- supported environments.
DO $$
DECLARE
    api_role text;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
            EXECUTE format('REVOKE ALL ON TABLE "_prisma_migrations" FROM %I', api_role);
            EXECUTE format(
                'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM %I',
                api_role
            );
        END IF;
    END LOOP;
END
$$;
