import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "./generated/prisma/client.js";

/**
 * Single PrismaClient across the process (avoids exhausting connections in dev
 * hot-reload). Prisma 7 requires a driver adapter; we use PrismaPg against the
 * POOLED connection (DATABASE_URL). RLS is enforced via session variables.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrisma(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL ?? "",
  });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrisma();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Run a unit of work as a specific user with Postgres RLS enforced.
 *
 * Guardrail (CLAUDE.md): tenancy lives in the database, never in app code or the
 * LLM. We open an interactive transaction and `SET LOCAL app.current_user_id`,
 * which is scoped to that transaction/connection only. RLS policies read this
 * GUC, so every query inside `fn` sees only the user's rows — even a query with
 * no WHERE clause.
 *
 * The NL-query path MUST go through this helper.
 */
export async function withUserContext<T>(
  userId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  // Fail loud on a missing/invalid user id. Without this guard an empty or
  // malformed value would silently produce a context that matches no rows
  // (reads return nothing, writes fail WITH CHECK) — a confusing functional
  // failure on the tenancy-critical path rather than an explicit error.
  if (typeof userId !== "string" || !UUID_RE.test(userId)) {
    throw new Error("withUserContext: userId must be a valid UUID");
  }
  return prisma.$transaction(async (tx) => {
    // Switch to the least-privilege, RLS-subject role for this transaction. The
    // connection authenticates as an admin role (which has BYPASSRLS on Supabase),
    // so without this SET LOCAL ROLE the policies would be skipped entirely.
    // The role name is a hardcoded, quoted identifier — NEVER interpolate a
    // caller-derived value here (SET ROLE cannot be parameterized, so a variable
    // role would be an injection sink on the tenancy-critical path).
    await tx.$executeRawUnsafe('SET LOCAL ROLE "clarifi_app"');
    // set_config(name, value, is_local=true) — parameterized, scoped to this tx.
    await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
    return fn(tx);
  });
}

/**
 * Like {@link withUserContext}, but for the NL-query execution path: runs as the
 * least-privilege, SELECT-only `clarifi_readonly` role inside a transaction that
 * is also marked `transaction_read_only = on`.
 *
 * Guardrail (CLAUDE.md): generated NL→SQL is validated against an AST allowlist
 * AND executed on a read-only DB role. This helper provides the read-only role;
 * RLS still isolates rows by `app.current_user_id`. Defense in depth — even a
 * compiler/validator gap cannot mutate data here. NEVER run trusted writes
 * through this helper.
 */
export async function withReadOnlyUserContext<T>(
  userId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (typeof userId !== "string" || !UUID_RE.test(userId)) {
    throw new Error("withReadOnlyUserContext: userId must be a valid UUID");
  }
  return prisma.$transaction(async (tx) => {
    // Least-privilege, RLS-subject, SELECT-only role. The role name is a
    // hardcoded literal — never interpolate a caller-derived value here.
    await tx.$executeRawUnsafe('SET LOCAL ROLE "clarifi_readonly"');
    await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
    // Belt-and-suspenders: the database rejects any write in this transaction
    // even if a grant or the validator ever regresses. Set last so the GUC
    // write above isn't affected.
    await tx.$executeRawUnsafe("SET LOCAL transaction_read_only = on");
    return fn(tx);
  });
}

export { Prisma };
export type { PrismaClient } from "./generated/prisma/client.js";
