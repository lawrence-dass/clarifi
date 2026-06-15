import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

// Load the monorepo-root .env so DB-dependent tests (e.g. the RLS isolation
// test) see DATABASE_URL. Pure-unit tests (money) are unaffected.
loadEnv({ path: path.resolve(import.meta.dirname, "../../.env") });

export default defineConfig({
  test: {
    // The RLS test hits a live DB and shares rows across cases; run serially.
    fileParallelism: false,
  },
});
