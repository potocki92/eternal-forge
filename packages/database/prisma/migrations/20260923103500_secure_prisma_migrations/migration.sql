-- ---------------------------------------------------------------------------
-- Supabase hardening for Prisma's internal migration table.
--
-- Prisma creates `_prisma_migrations` before applying the project's first
-- migration. Hosted Supabase projects grant default table privileges to the
-- browser-facing `anon` and `authenticated` roles, so the technical migration
-- ledger must be hardened explicitly just like the gameplay tables.
--
-- The table owner (`postgres`, used by Prisma Migrate) remains able to read and
-- write this table because ordinary RLS does not constrain the owner unless
-- FORCE ROW LEVEL SECURITY is enabled.
-- ---------------------------------------------------------------------------

ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;

-- Supabase defines these roles; plain PostgreSQL used by local development and
-- CI does not necessarily do so. Guard the revocation so the migration remains
-- portable across all supported environments.
DO $$
DECLARE
    api_role text;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
            EXECUTE format('REVOKE ALL ON TABLE "_prisma_migrations" FROM %I', api_role);
        END IF;
    END LOOP;
END
$$;
