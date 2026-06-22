import { prisma, withUserContext } from "@clarifi/shared";
import { config } from "../config.js";
import { clearDemoQuota } from "../modules/demo/demo-quota.js";

// TTL reaper for public-demo users (Story 12.2).
//
// Demo users carry `demoExpiresAt` (written at provision time, Story 12.1). This
// sweep deletes the expired ones end-to-end via the EXISTING deletion path:
// `withUserContext(userId)` → `tx.user.delete`, so RLS applies and ON DELETE
// CASCADE removes accounts, transactions, plaid items, anomalies, budgets,
// consents, and refresh tokens (the Story 1.6 PIPEDA guarantee). The reaper IS
// the demo's deletion path — no orphaned rows.
//
// Mirrors `categorize.reconcile`: a base-client cross-tenant SCAN (read-only,
// no writes), then per-user work under tenant context. Batch-bounded so one
// sweep can never issue an unbounded number of deletes.

const DEFAULT_INTERVAL_MS = 5 * 60_000;

export interface ReapOptions {
  batch?: number;
}

/**
 * Delete demo users whose TTL has passed. Returns the number deleted.
 * Base client for the scan (cross-tenant, read-only); each delete runs under the
 * user's RLS context so the cascade executes as the owning tenant.
 */
export async function reapExpiredDemoUsers(options: ReapOptions = {}): Promise<number> {
  const batch = options.batch ?? config.DEMO_REAP_BATCH;
  const expired = await prisma.user.findMany({
    where: { isDemo: true, demoExpiresAt: { lt: new Date() } },
    select: { id: true },
    take: batch,
  });

  let deleted = 0;
  for (const { id } of expired) {
    try {
      await withUserContext(id, (tx) => tx.user.delete({ where: { id } }));
      await clearDemoQuota(id);
      deleted += 1;
    } catch {
      // A row deleted by a racing sweep (P2025) or a transient error — skip it;
      // the next tick re-derives the remaining expired set. Never crash the worker.
    }
  }
  return deleted;
}

export function startDemoReaper(intervalMs = config.DEMO_REAP_INTERVAL_MS ?? DEFAULT_INTERVAL_MS): () => void {
  const tick = () =>
    void reapExpiredDemoUsers().catch(() => {
      // Never kill the worker; the next tick retries.
    });
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  tick(); // opportunistic first run on startup
  return () => clearInterval(timer);
}
