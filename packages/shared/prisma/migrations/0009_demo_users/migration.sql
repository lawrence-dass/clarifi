-- Story 12.1: ephemeral public-demo users.
--
-- Adds two columns to `users` for the one-click demo:
--   is_demo          — marks an anonymous, synthetic-data-only demo account.
--   demo_expires_at  — written at provision time (now + 1h); Story 12.2's TTL
--                      reaper deletes the user once it passes (cascade removes
--                      all child rows, satisfying the PIPEDA deletion path).
--
-- RLS: `users` is already RLS-enabled (0002) and the users_insert policy (0004)
-- already admits the pre-auth insert demo provisioning uses (no app.current_user_id
-- set), exactly as registration. No policy change is required for these columns.

ALTER TABLE "users" ADD COLUMN "is_demo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "demo_expires_at" TIMESTAMP(3);

-- The 12.2 reaper scans expired demo users on this composite.
CREATE INDEX "users_is_demo_demo_expires_at_idx" ON "users" ("is_demo", "demo_expires_at");
