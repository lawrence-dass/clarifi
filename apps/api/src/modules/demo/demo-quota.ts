import Redis from "ioredis";
import { config } from "../../config.js";
import { redisConfigError } from "../../queues/categorize.queue.js";
import { tooManyRequests } from "../../lib/app-error.js";
import { DEMO_TTL_MS } from "./demo.service.js";

// Same fail-fast ioredis options as the rate limiter / merchant cache.
let redis: Redis | null = null;
function getRedis(): Redis {
  return (redis ??= new Redis(config.REDIS_URL as string, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    commandTimeout: 3_000,
    connectTimeout: 5_000,
  }));
}

export function demoQuotaKey(userId: string): string {
  return `demo:nlq:${userId}`;
}

/**
 * Enforce the per-demo-session NL-query quota (Story 12.2).
 *
 * INCRs a Redis counter keyed by the demo user id (TTL ≥ the demo lifetime) and
 * throws 429 once the count exceeds `DEMO_SESSION_NL_QUOTA` — BEFORE any LLM
 * call, so a demo session can never run up Claude spend past the cap. Fails OPEN
 * when Redis is unconfigured (dev/CI). Call only for demo users.
 */
export async function enforceDemoNLQuota(userId: string): Promise<void> {
  if (redisConfigError(config.REDIS_URL)) return; // fail open
  let count: number;
  try {
    const key = demoQuotaKey(userId);
    const client = getRedis();
    count = await client.incr(key);
    // TTL outlives the demo so the cap can't be reset by mid-session expiry.
    if (count === 1) await client.expire(key, Math.ceil(DEMO_TTL_MS / 1000) + 60);
  } catch {
    return; // fail open on Redis error
  }
  if (count > config.DEMO_SESSION_NL_QUOTA) {
    throw tooManyRequests(
      "DEMO_QUOTA_EXCEEDED",
      "You've reached the demo's query limit. Sign up for a free account to keep exploring.",
    );
  }
}

/** Best-effort removal of a demo session's quota counter (used by the reaper). */
export async function clearDemoQuota(userId: string): Promise<void> {
  if (redisConfigError(config.REDIS_URL)) return;
  try {
    await getRedis().del(demoQuotaKey(userId));
  } catch {
    // best effort — the key carries its own TTL and expires on its own.
  }
}
