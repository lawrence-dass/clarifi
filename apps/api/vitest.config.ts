import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

// Load the monorepo-root .env so DB-dependent tests (the registration
// integration test) see DATABASE_URL. Pure-unit tests are unaffected.
loadEnv({ path: path.resolve(import.meta.dirname, "../../.env") });

export default defineConfig({
  test: {
    // DB-touching tests share rows; run serially to avoid cross-test races.
    fileParallelism: false,
  },
});
