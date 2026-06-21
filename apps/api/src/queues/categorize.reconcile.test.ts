import { afterEach, describe, expect, it, vi } from "vitest";

const groupBy = vi.fn();
vi.mock("@clarifi/shared", () => ({ prisma: { transaction: { groupBy } } }));

const enqueueCategorize = vi.fn(async () => undefined);
const redisConfigError = vi.fn((_url?: string): string | null => null);
vi.mock("./categorize.queue.js", () => ({ enqueueCategorize, redisConfigError }));

const { requeueStaleCategorization } = await import("./categorize.reconcile.js");

describe("requeueStaleCategorization", () => {
  afterEach(() => {
    vi.clearAllMocks();
    redisConfigError.mockReturnValue(null);
  });

  it("re-enqueues a categorize job for each stuck account", async () => {
    groupBy.mockResolvedValue([
      { accountId: "a1", userId: "u1" },
      { accountId: "a2", userId: "u2" },
    ]);

    const n = await requeueStaleCategorization();

    expect(n).toBe(2);
    expect(enqueueCategorize).toHaveBeenCalledWith({ userId: "u1", accountId: "a1" });
    expect(enqueueCategorize).toHaveBeenCalledWith({ userId: "u2", accountId: "a2" });

    // Only stuck rows: category null, not removed, bounded by grace (lt) + maxAge (gte).
    const where = groupBy.mock.calls[0]![0].where;
    expect(where.category).toBeNull();
    expect(where.status).toEqual({ not: "removed" });
    expect(where.createdAt.lt).toBeInstanceOf(Date);
    expect(where.createdAt.gte).toBeInstanceOf(Date);
    expect(where.createdAt.lt.getTime()).toBeGreaterThan(where.createdAt.gte.getTime());
  });

  it("does nothing when Redis is not configured (no scan, no enqueue)", async () => {
    redisConfigError.mockReturnValue("REDIS_URL is not set");

    const n = await requeueStaleCategorization();

    expect(n).toBe(0);
    expect(groupBy).not.toHaveBeenCalled();
    expect(enqueueCategorize).not.toHaveBeenCalled();
  });

  it("honours custom grace/maxAge windows", async () => {
    groupBy.mockResolvedValue([]);

    await requeueStaleCategorization({ graceMs: 1_000, maxAgeMs: 10_000 });

    const where = groupBy.mock.calls[0]![0].where;
    const span = where.createdAt.lt.getTime() - where.createdAt.gte.getTime();
    expect(span).toBe(9_000); // maxAge - grace
  });
});
