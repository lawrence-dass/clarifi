import type { NextFunction, Request, Response } from "express";
import Redis from "ioredis";
import { config } from "../config.js";
import { redisConfigError } from "../queues/categorize.queue.js";
import { tooManyRequests } from "../lib/app-error.js";

// Shared ioredis client for rate-limit counters. Same fail-fast options as the
// merchant cache: don't queue while offline, time out a stuck command, so a
// Redis blip never hangs a request (the limiter fails open instead).
let redis: Redis | null = null;
function getRedis(): Redis {
  return (redis ??= new Redis(config.REDIS_URL as string, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    commandTimeout: 3_000,
    connectTimeout: 5_000,
  }));
}

export interface RateLimitOptions {
  keyPrefix: string;
  limit: number;
  windowSec: number;
}

/**
 * Per-IP fixed-window rate limiter backed by Redis (Story 12.2): INCR a per-IP
 * counter, set EX on the first hit of a window, reject at `> limit` with 429.
 *
 * Fails OPEN when Redis is unconfigured (dev/CI) or errors — the limiter must
 * never hang or 500 a request; an outage degrades to "no limit", not "no
 * service". Requires `trust proxy` so `req.ip` is the real client (see app.ts).
 */
export function rateLimit(options: RateLimitOptions) {
  return async function rateLimitMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    // Disabled under test so route e2e suites don't share an accumulating per-IP
    // counter on the real Redis across runs (the limiter logic is unit-tested
    // directly). Mirrors how Turnstile bypasses when unconfigured.
    if (config.NODE_ENV === "test") return next();
    if (redisConfigError(config.REDIS_URL)) return next(); // fail open
    try {
      const key = `ratelimit:${options.keyPrefix}:${req.ip ?? "unknown"}`;
      const client = getRedis();
      const count = await client.incr(key);
      if (count === 1) await client.expire(key, options.windowSec);
      if (count > options.limit) {
        next(tooManyRequests("RATE_LIMITED", "Too many requests — please slow down and try again shortly."));
        return;
      }
      next();
    } catch {
      next(); // fail open on Redis error
    }
  };
}
