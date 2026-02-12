-- Migration: reload_schema_and_perms
-- Description: Reload PostgREST schema cache and ensure public permissions.
-- Reason: Fix 404/406 errors on frontend after creating new tables via SQL Editor.
-- 1. Grant permissions to standard Supabase roles
-- Ensure 'anon' and 'authenticated' can see the new tables in public schema
GRANT USAGE ON SCHEMA public TO postgres,
    anon,
    authenticated,
    service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres,
    anon,
    authenticated,
    service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO postgres,
    anon,
    authenticated,
    service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres,
    anon,
    authenticated,
    service_role;
-- 2. Ensure future tables also get these permissions (good practice)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT ALL ON TABLES TO postgres,
    anon,
    authenticated,
    service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT ALL ON FUNCTIONS TO postgres,
    anon,
    authenticated,
    service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT ALL ON SEQUENCES TO postgres,
    anon,
    authenticated,
    service_role;
-- 3. Force PostgREST to reload schema cache
-- This makes the API recognize the newly created tables immediately
NOTIFY pgrst,
'reload schema';