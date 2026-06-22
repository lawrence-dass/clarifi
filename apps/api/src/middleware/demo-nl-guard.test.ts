import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

// rateLimit is a factory; mock it to a pass-through so the guard's wiring (not the
// limiter internals, covered separately) is what's under test.
vi.mock("./rate-limit.js", () => ({
  rateLimit: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const quota = vi.hoisted(() => ({ enforceDemoNLQuota: vi.fn(async () => undefined) }));
vi.mock("../modules/demo/demo-quota.js", () => quota);

vi.mock("../config.js", () => ({
  config: { DEMO_NL_RATE_LIMIT: 60, DEMO_NL_RATE_WINDOW_SEC: 3600, REDIS_URL: "rediss://x" },
}));

import { demoNLGuard } from "./demo-nl-guard.js";

function run(req: Partial<Request>): Promise<unknown> {
  return new Promise((resolve) => {
    const next: NextFunction = (err?: unknown) => resolve(err ?? null);
    demoNLGuard(req as Request, {} as Response, next);
  });
}

afterEach(() => vi.clearAllMocks());

describe("demoNLGuard", () => {
  it("passes a real (non-demo) user straight through without quota checks", async () => {
    const result = await run({ isDemo: false, userId: "real-1" });
    expect(result).toBeNull();
    expect(quota.enforceDemoNLQuota).not.toHaveBeenCalled();
  });

  it("enforces the per-session quota for a demo user", async () => {
    const result = await run({ isDemo: true, userId: "demo-1" });
    expect(result).toBeNull();
    expect(quota.enforceDemoNLQuota).toHaveBeenCalledWith("demo-1");
  });

  it("propagates a quota-exceeded error for a demo user", async () => {
    quota.enforceDemoNLQuota.mockRejectedValueOnce(
      Object.assign(new Error("limit"), { code: "DEMO_QUOTA_EXCEEDED", httpStatus: 429 }),
    );
    const result = await run({ isDemo: true, userId: "demo-2" });
    expect(result).toMatchObject({ code: "DEMO_QUOTA_EXCEEDED" });
  });
});
