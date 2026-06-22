-- Story 12.3: per-demo "kind" so each demo seeds a single source.
--
-- Two coherent demo flavors (CSV = CAD sample; Plaid = Sandbox) instead of one
-- combined demo that mixed CAD/USD. `demo_kind` is recorded at provision time
-- and drives seeding, the UI badge, and the Add-data default. Additive + nullable
-- (null for real users and any pre-existing demo user). `users` already has RLS;
-- no policy change.

CREATE TYPE "DemoKind" AS ENUM ('csv', 'plaid');
ALTER TABLE "users" ADD COLUMN "demo_kind" "DemoKind";
