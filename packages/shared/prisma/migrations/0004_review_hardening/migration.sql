-- Review hardening (code review of Story 1.1, 2026-06-15).
-- Authored as a forward migration because 0002/0003 are already applied to the
-- live database; never edit an applied migration in place.

-- ── 1. Narrow the users INSERT policy ─────────────────────────────────────
-- 0002 made users INSERT fully permissive (WITH CHECK (true)) to solve the
-- signup chicken-and-egg (a brand-new user has no app.current_user_id yet).
-- That also let any code running inside withUserContext() mint a user row with
-- an arbitrary id. Narrow it so INSERT is allowed only when no context is set
-- (real signup) OR the new row's id matches the current user (the seed path).
DROP POLICY IF EXISTS "users_insert" ON "users";
CREATE POLICY "users_insert" ON "users" FOR INSERT
  WITH CHECK (
    NULLIF(current_setting('app.current_user_id', true), '') IS NULL
    OR "id" = current_setting('app.current_user_id', true)
  );

-- ── 2. Revoke over-broad grants on non-application tables ──────────────────
-- 0003 granted clarifi_app DML on ALL TABLES IN SCHEMA public. That swept in
-- `outbox` (intentionally NOT RLS-protected) and `_prisma_migrations`, so any
-- query running as clarifi_app (i.e. inside withUserContext) could read every
-- tenant's outbox payloads or tamper with the migration ledger. The outbox is
-- system-scoped and must be touched only by workers/service code using the
-- admin role; the migration ledger must never be reachable from app code.
REVOKE ALL PRIVILEGES ON TABLE "outbox" FROM clarifi_app;
REVOKE ALL PRIVILEGES ON TABLE "_prisma_migrations" FROM clarifi_app;
