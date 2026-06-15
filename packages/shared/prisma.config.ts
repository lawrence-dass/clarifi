import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// Prisma runs with cwd at packages/shared, but the .env lives at the monorepo
// root. Load it explicitly relative to this config file so DATABASE_URL/DIRECT_URL
// resolve regardless of where the command is invoked.
loadEnv({ path: path.resolve(import.meta.dirname, "../../.env") });

// Prisma 7 config. Env no longer auto-loads (dotenv above handles it).
// CLI/migrations use the DIRECT connection (Supabase port 5432); the app's
// runtime uses the POOLED connection via the PrismaPg driver adapter
// (see src/prisma.ts, DATABASE_URL).
//
// The placeholder lets offline commands (e.g. `prisma generate`) run before a
// real database is connected; `prisma migrate` requires a real DIRECT_URL in .env.
const migrationUrl =
  process.env.DIRECT_URL ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder";

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
  },
  datasource: {
    url: migrationUrl,
  },
});
