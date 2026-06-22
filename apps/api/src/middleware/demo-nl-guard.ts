import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { rateLimit } from "./rate-limit.js";
import { enforceDemoNLQuota } from "../modules/demo/demo-quota.js";

// Per-IP limiter for the NL-query path, applied to demo sessions only.
const nlRateLimit = rateLimit({
  keyPrefix: "demo-nl",
  limit: config.DEMO_NL_RATE_LIMIT,
  windowSec: config.DEMO_NL_RATE_WINDOW_SEC,
});

/**
 * Cost-control guard for `POST /query/nl` (Story 12.2). Applies ONLY to demo
 * sessions (`req.isDemo`, set by requireAuth): per-IP rate limit + per-session
 * NL-query quota, both enforced BEFORE the controller reaches the LLM gateway.
 * Real (non-demo) users pass straight through, unaffected.
 */
export function demoNLGuard(req: Request, res: Response, next: NextFunction): void {
  if (!req.isDemo || !req.userId) return next();
  const userId = req.userId;
  nlRateLimit(req, res, (err?: unknown) => {
    if (err) return next(err);
    enforceDemoNLQuota(userId).then(() => next()).catch(next);
  });
}
