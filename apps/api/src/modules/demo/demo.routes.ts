import { Router } from "express";
import { config } from "../../config.js";
import { verifyTurnstile } from "../../middleware/turnstile.js";
import { rateLimit } from "../../middleware/rate-limit.js";
import { createDemoSession } from "./demo.controller.js";

export const demoRouter: Router = Router();

// Public entry — no requireAuth. Bot-gate (Turnstile) then per-IP rate limit run
// BEFORE provisioning, so automated traffic can't mass-mint demo users or run up
// LLM/compute cost (Story 12.2). Turnstile bypasses when unconfigured (dev/CI).
demoRouter.post(
  "/session",
  verifyTurnstile,
  rateLimit({
    keyPrefix: "demo-mint",
    limit: config.DEMO_MINT_RATE_LIMIT,
    windowSec: config.DEMO_MINT_RATE_WINDOW_SEC,
  }),
  createDemoSession,
);
