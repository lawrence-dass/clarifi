import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const redisState = vi.hoisted(() => ({ count: 0 }));
const redisClient = vi.hoisted(() => ({
  incr: vi.fn(async () => ++redisState.count),
  expire: vi.fn(async () => 1),
  del: vi.fn(async () => 1),
}));
vi.mock("ioredis", () => ({ default: vi.fn(() => redisClient) }));

const cfg = vi.hoisted(() => ({
  config: { REDIS_URL: "rediss://real-host:6379", DEMO_SESSION_NL_QUOTA: 3 },
}));
vi.mock("../../config.js", () => cfg);

const rce = vi.hoisted(() => ({ value: null as string | null }));
vi.mock("../../queues/categorize.queue.js", () => ({ redisConfigError: () => rce.value }));

// Avoid pulling the heavy provisioning graph (prisma/plaid/csv) into this unit test.
vi.mock("./demo.service.js", () => ({ DEMO_TTL_MS: 60 * 60 * 1000 }));

import { enforceDemoNLQuota } from "./demo-quota.js";

beforeEach(() => {
  redisState.count = 0;
  rce.value = null;
});
afterEach(() => vi.clearAllMocks());

describe("enforceDemoNLQuota", () => {
  it("allows queries up to the quota and rejects beyond it", async () => {
    await expect(enforceDemoNLQuota("u1")).resolves.toBeUndefined(); // 1
    await expect(enforceDemoNLQuota("u1")).resolves.toBeUndefined(); // 2
    await expect(enforceDemoNLQuota("u1")).resolves.toBeUndefined(); // 3 (== quota)
    await expect(enforceDemoNLQuota("u1")).rejects.toMatchObject({
      code: "DEMO_QUOTA_EXCEEDED",
      httpStatus: 429,
    }); // 4 (> quota)
  });

  it("sets the counter TTL only on the first query", async () => {
    await enforceDemoNLQuota("u1");
    await enforceDemoNLQuota("u1");
    expect(redisClient.expire).toHaveBeenCalledTimes(1);
  });

  it("fails open (no enforcement) when Redis is unconfigured", async () => {
    rce.value = "REDIS_URL is not set";
    for (let i = 0; i < 10; i++) {
      await expect(enforceDemoNLQuota("u1")).resolves.toBeUndefined();
    }
    expect(redisClient.incr).not.toHaveBeenCalled();
  });
});
