-- Make the RLS-subject role's security intent explicit (code review of Story 1.1).
--
-- clarifi_app was created NOLOGIN in 0003 and relies on the Postgres default of
-- NOBYPASSRLS. State it explicitly so the role can never be accidentally altered
-- to bypass row-level security — the whole point of the role is to BE subject to
-- RLS. Idempotent; safe to re-run.
ALTER ROLE clarifi_app NOBYPASSRLS;
