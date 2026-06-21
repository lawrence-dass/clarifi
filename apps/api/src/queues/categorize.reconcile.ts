import { prisma } from "@clarifi/shared";
import { config } from "../config.js";
import { enqueueCategorize, redisConfigError } from "./categorize.queue.js";

// Reconciliation backstop for categorization (story 10.1).
//
// The outbox marks a row processed when the categorize job is *enqueued*, not
// when it *succeeds* — so a job that exhausts its retries leaves transactions
// stuck at category = null with nothing re-dispatching. This sweep re-derives
// pending work from the durable source of truth (uncategorized transactions)
// rather than an outbox flag, and re-enqueues it. The categorize job only
// touches category-null rows, so a re-enqueue that races a succeeding job is a
// no-op.

// Don't sweep just-imported rows — the fast path is probably still working them.
const DEFAULT_GRACE_MS = 2 * 60_000; // 2 minutes
// Poison guard: stop retrying a row that has been stuck this long.
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60_000; // 24 hours
const DEFAULT_INTERVAL_MS = 5 * 60_000; // 5 minutes

export interface ReconcileOptions {
  graceMs?: number;
  maxAgeMs?: number;
}

/**
 * Find accounts that still have stuck uncategorized transactions and re-enqueue
 * a categorize job for each. Returns the number of accounts re-queued.
 */
export async function requeueStaleCategorization(options: ReconcileOptions = {}): Promise<number> {
  // Don't enqueue into a Redis that isn't there; the next tick retries.
  if (redisConfigError(config.REDIS_URL)) return 0;

  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const now = Date.now();
  const staleBefore = new Date(now - graceMs);
  const tooOld = new Date(now - maxAgeMs);

  // Base client (no RLS context) for the cross-tenant scan — the same pattern as
  // the webhook→worker owner lookup. No writes happen here; the categorize job
  // does all user-data writes under withUserContext. Transaction carries userId
  // directly (@@index([userId, category])), so no Account join is needed.
  const stuck = await prisma.transaction.groupBy({
    by: ["accountId", "userId"],
    where: {
      category: null,
      status: { not: "removed" },
      createdAt: { lt: staleBefore, gte: tooOld },
    },
  });

  for (const { accountId, userId } of stuck) {
    await enqueueCategorize({ userId, accountId });
  }
  return stuck.length;
}

export function startCategorizeReconciler(intervalMs = DEFAULT_INTERVAL_MS): () => void {
  const tick = () =>
    void requeueStaleCategorization().catch(() => {
      // Never kill the worker; the next tick retries.
    });
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  tick(); // opportunistic first run on startup
  return () => clearInterval(timer);
}
