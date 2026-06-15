-- Least-privilege application role that is SUBJECT TO RLS.
--
-- Why: the Supabase `postgres` role (used for migrations and the connection) has
-- the BYPASSRLS attribute, so RLS policies are skipped when querying as postgres —
-- regardless of FORCE. To actually enforce tenancy, runtime queries must execute
-- as a role WITHOUT BYPASSRLS.
--
-- How: `clarifi_app` is a NOLOGIN role (no password/secret to manage) granted to
-- the connecting role. withUserContext() does `SET LOCAL ROLE clarifi_app` inside
-- its transaction, so every app query runs as the RLS-subject role while
-- migrations continue to run as the admin role.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clarifi_app') THEN
    CREATE ROLE clarifi_app NOLOGIN;
  END IF;
END
$$;

-- Privileges on the schema and existing tables (RLS still constrains rows).
GRANT USAGE ON SCHEMA public TO clarifi_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO clarifi_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO clarifi_app;

-- Future tables/sequences created by the admin role get the same grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO clarifi_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO clarifi_app;

-- Allow the connecting (migration/runtime) role to SET ROLE clarifi_app.
DO $$
BEGIN
  EXECUTE format('GRANT clarifi_app TO %I', current_user);
END
$$;
