-- Enable Row Level Security (RLS) for multi-tenancy.
--
-- Tenancy is enforced in the DATABASE, never in application code or the LLM
-- (see CLAUDE.md + architecture.md). Every query the app runs is wrapped in
-- withUserContext(userId), which executes `set_config('app.current_user_id', userId, true)`
-- inside a transaction. The policies below read that GUC and filter rows.
--
-- FORCE is mandatory: Prisma/Supabase connect as the table OWNER, and owners
-- BYPASS plain RLS. FORCE makes the owner subject to policies too — without it
-- isolation silently does not apply.
--
-- Prisma maps String ids to Postgres `text` (not `uuid`), so we compare the GUC
-- as text. NULLIF(current_setting('app.current_user_id', true), '') returns NULL
-- when no context is set (missing_ok = true), so rows are denied by default
-- outside of withUserContext.

-- ── users (scoped on id) ──────────────────────────────────────────────────
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;

CREATE POLICY "users_select" ON "users" FOR SELECT
  USING ("id" = NULLIF(current_setting('app.current_user_id', true), ''));
CREATE POLICY "users_update" ON "users" FOR UPDATE
  USING ("id" = NULLIF(current_setting('app.current_user_id', true), ''))
  WITH CHECK ("id" = NULLIF(current_setting('app.current_user_id', true), ''));
CREATE POLICY "users_delete" ON "users" FOR DELETE
  USING ("id" = NULLIF(current_setting('app.current_user_id', true), ''));
-- Signup happens before any auth context exists, so INSERT is permissive.
-- Registration is guarded at the application boundary (Zod + argon2, Story 1.2).
CREATE POLICY "users_insert" ON "users" FOR INSERT
  WITH CHECK (true);

-- ── accounts ──────────────────────────────────────────────────────────────
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "accounts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "accounts_isolation" ON "accounts" FOR ALL
  USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), ''))
  WITH CHECK ("user_id" = NULLIF(current_setting('app.current_user_id', true), ''));

-- ── transactions ──────────────────────────────────────────────────────────
ALTER TABLE "transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transactions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "transactions_isolation" ON "transactions" FOR ALL
  USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), ''))
  WITH CHECK ("user_id" = NULLIF(current_setting('app.current_user_id', true), ''));

-- ── budgets ───────────────────────────────────────────────────────────────
ALTER TABLE "budgets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "budgets" FORCE ROW LEVEL SECURITY;
CREATE POLICY "budgets_isolation" ON "budgets" FOR ALL
  USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), ''))
  WITH CHECK ("user_id" = NULLIF(current_setting('app.current_user_id', true), ''));

-- ── anomalies ─────────────────────────────────────────────────────────────
ALTER TABLE "anomalies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "anomalies" FORCE ROW LEVEL SECURITY;
CREATE POLICY "anomalies_isolation" ON "anomalies" FOR ALL
  USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), ''))
  WITH CHECK ("user_id" = NULLIF(current_setting('app.current_user_id', true), ''));

-- ── consents ──────────────────────────────────────────────────────────────
ALTER TABLE "consents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consents" FORCE ROW LEVEL SECURITY;
CREATE POLICY "consents_isolation" ON "consents" FOR ALL
  USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), ''))
  WITH CHECK ("user_id" = NULLIF(current_setting('app.current_user_id', true), ''));

-- ── outbox: intentionally NOT RLS-protected ───────────────────────────────
-- System table touched only by workers/service code, never by user-scoped queries.
