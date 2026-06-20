-- Read-only, RLS-subject role for the NL-query execution path (defense in depth).
--
-- The NL→IR→SQL pipeline compiles a constrained IR to parameterized SQL and
-- validates it against an AST allowlist, but per CLAUDE.md that generated SQL
-- must ALSO run on a READ-ONLY database role so a compiler/validator gap can
-- never mutate data. clarifi_readonly is NOLOGIN + NOBYPASSRLS (RLS still
-- isolates rows by app.current_user_id) and holds SELECT only — no
-- INSERT/UPDATE/DELETE. withReadOnlyUserContext() does
-- `SET LOCAL ROLE clarifi_readonly` + `SET LOCAL transaction_read_only = on`
-- for the query transaction. Idempotent; safe to re-run.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clarifi_readonly') THEN
    CREATE ROLE clarifi_readonly NOLOGIN;
  END IF;
END
$$;

-- The role must always be subject to RLS, never bypass it.
ALTER ROLE clarifi_readonly NOBYPASSRLS;

-- SELECT only. The role-agnostic RLS policies (keyed on app.current_user_id)
-- still constrain which rows are visible. No INSERT/UPDATE/DELETE, no sequences.
GRANT USAGE ON SCHEMA public TO clarifi_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO clarifi_readonly;

-- Future tables created by the admin role are readable too.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO clarifi_readonly;

-- Allow the connecting (migration/runtime) role to SET ROLE clarifi_readonly.
DO $$
BEGIN
  EXECUTE format('GRANT clarifi_readonly TO %I', current_user);
END
$$;
