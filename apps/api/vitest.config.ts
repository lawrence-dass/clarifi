import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

// Load the monorepo-root .env so DB-dependent tests (the registration
// integration test) see DATABASE_URL. Pure-unit tests are unaffected.
loadEnv({ path: path.resolve(import.meta.dirname, "../../.env") });

// Prefer an ISOLATED test database when provided. DB-backed tests assert exact
// row counts; running them against the shared dev DB makes them flaky whenever a
// worker process is live (its outbox drainers / categorize jobs mutate rows
// mid-test). Point TEST_DATABASE_URL at a throwaway local Postgres so the suite
// never shares state with the dev DB or a running worker. Falls back to
// DATABASE_URL when unset (existing behaviour). Set before any Prisma import.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DIRECT_URL = process.env.TEST_DIRECT_URL ?? process.env.TEST_DATABASE_URL;
}

export default defineConfig({
  test: {
    // DB-touching tests share rows; run serially to avoid cross-test races.
    fileParallelism: false,
    // DB-backed e2e tests hit a remote (Supabase) database over the network;
    // cascade deletes and concurrent-refresh checks can take several seconds.
    // Set generous global timeouts here so robustness doesn't depend on every
    // caller remembering to pass --testTimeout/--hookTimeout on the CLI.
    testTimeout: 40_000,
    hookTimeout: 40_000,
  },
});
