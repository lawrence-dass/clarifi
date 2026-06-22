import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { badRequest } from "../../lib/app-error.js";
import { issueUserSession } from "../auth/auth.service.js";
import { setAuthCookies } from "../auth/cookies.js";
import { provisionDemoUser } from "./demo.service.js";

// Which demo flavor to provision (Story 12.3). The two landing entries each send one.
const DemoSessionBody = z.object({ kind: z.enum(["csv", "plaid"]) });

/**
 * POST /demo/session — provision a fresh anonymous demo user, seed it with
 * synthetic data through the canonical adapters, start an authenticated session
 * (same access + refresh cookies as login), and return the public demo user
 * (201). No auth required — this is the public entry point.
 *
 * Abuse/cost controls (Turnstile, per-IP rate limits, per-session LLM quota)
 * are Story 12.2 and will mount as middleware in front of this route.
 */
export async function createDemoSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = DemoSessionBody.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest("INVALID_DEMO_KIND", "A demo kind (csv | plaid) is required", parsed.error.flatten());
    }
    const user = await provisionDemoUser({ kind: parsed.data.kind });
    const { accessToken, refreshToken } = await issueUserSession(user.id);
    setAuthCookies(res, { accessToken, refreshToken });
    res.status(201).json({
      id: user.id,
      email: user.email,
      consentedAt: user.consentedAt,
      isDemo: true,
      demoKind: user.demoKind,
    });
  } catch (err) {
    next(err);
  }
}
