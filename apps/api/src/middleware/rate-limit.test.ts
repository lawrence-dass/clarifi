import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

const redisState = vi.hoisted(() => ({ count: 0, throwOnIncr: false }));
const redisClient = vi.hoisted(() => ({
  incr: vi.fn(async () => {
    if (redisState.throwOnIncr) throw new Error("redis down");
    return ++redisState.count;
  }),
  expire: vi.fn(async () => 1),
}));
vi.mock("ioredis", () => ({ default: vi.fn(() => redisClient) }));

const cfg = vi.hoisted(() => ({ config: { REDIS_URL: "rediss://real-host:6379" } }));
vi.mock("../config.js", () => cfg);

const rce = vi.hoisted(() => ({ value: null as string | null }));
vi.mock("../queues/categorize.queue.js", () => ({ redisConfigError: () => rce.value }));

import { rateLimit } from "./rate-limit.js";

function req(ip = "9.9.9.9"): Request {
  return { ip } as unknown as Request;
}
async function invoke(mw: ReturnType<typeof rateLimit>): Promise<unknown> {
  let captured: unknown = "NOT_CALLED";
  const next: NextFunction = (err?: unknown) => {
    captured = err ?? null;
  };
  await mw(req(), {} as Response, next);
  return captured;
}

beforeEach(() => {
  redisState.count = 0;
  redisState.throwOnIncr = false;
  rce.value = null;
});
afterEach(() => vi.clearAllMocks());

describe("rateLimit middleware", () => {
  it("allows requests up to the limit and 429s beyond it", async () => {
    const mw = rateLimit({ keyPrefix: "t", limit: 2, windowSec: 60 });
    expect(await invoke(mw)).toBeNull(); // 1
    expect(await invoke(mw)).toBeNull(); // 2
    expect(await invoke(mw)).toMatchObject({ code: "RATE_LIMITED", httpStatus: 429 }); // 3
  });

  it("sets the window TTL only on the first hit", async () => {
    const mw = rateLimit({ keyPrefix: "t", limit: 5, windowSec: 60 });
    await invoke(mw);
    await invoke(mw);
    expect(redisClient.expire).toHaveBeenCalledTimes(1);
  });

  it("fails open (passes) when Redis is unconfigured", async () => {
    rce.value = "REDIS_URL is not set";
    const mw = rateLimit({ keyPrefix: "t", limit: 1, windowSec: 60 });
    expect(await invoke(mw)).toBeNull();
    expect(await invoke(mw)).toBeNull(); // would 429 if it were counting
    expect(redisClient.incr).not.toHaveBeenCalled();
  });

  it("fails open when a Redis command errors", async () => {
    redisState.throwOnIncr = true;
    const mw = rateLimit({ keyPrefix: "t", limit: 1, windowSec: 60 });
    expect(await invoke(mw)).toBeNull();
  });
});
