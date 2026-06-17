import { beforeEach, describe, expect, it, vi } from "vitest";
import { Category, TransactionDirection, TransactionStatus, withUserContext } from "@clarifi/shared";
import { categoryBreakdown, spendingTrend } from "./transactions.service.js";

vi.mock("@clarifi/shared", async (importActual) => {
  const actual = await importActual<typeof import("@clarifi/shared")>();
  return {
    ...actual,
    withUserContext: vi.fn(),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("categoryBreakdown", () => {
  it("uses one RLS-scoped groupBy query and shapes per-currency integer cents", async () => {
    const groupBy = vi.fn().mockResolvedValue([
      {
        currency: "USD",
        category: Category.travel,
        _sum: { amountCents: -8000n },
        _count: { _all: 1 },
      },
      {
        currency: "CAD",
        category: Category.transport,
        _sum: { amountCents: -1200n },
        _count: { _all: 1 },
      },
      {
        currency: "CAD",
        category: Category.food_and_dining,
        _sum: { amountCents: -3250n },
        _count: { _all: 2 },
      },
    ]);
    vi.mocked(withUserContext).mockImplementation(async (_userId, fn) =>
      fn({ transaction: { groupBy } } as never),
    );

    await expect(categoryBreakdown({ userId: "user-1", month: "2026-06" })).resolves.toEqual({
      month: "2026-06",
      currencies: [
        {
          currency: "CAD",
          totalCents: 4450,
          categories: [
            { category: Category.food_and_dining, totalCents: 3250, transactionCount: 2 },
            { category: Category.transport, totalCents: 1200, transactionCount: 1 },
          ],
        },
        {
          currency: "USD",
          totalCents: 8000,
          categories: [
            { category: Category.travel, totalCents: 8000, transactionCount: 1 },
          ],
        },
      ],
    });

    expect(withUserContext).toHaveBeenCalledTimes(1);
    expect(withUserContext).toHaveBeenCalledWith("user-1", expect.any(Function));
    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(groupBy).toHaveBeenCalledWith({
      by: ["currency", "category"],
      where: {
        date: {
          gte: new Date("2026-06-01T00:00:00.000Z"),
          lt: new Date("2026-07-01T00:00:00.000Z"),
        },
        direction: TransactionDirection.debit,
        amountCents: {
          lt: 0,
        },
        status: {
          not: TransactionStatus.removed,
        },
        category: {
          not: null,
        },
      },
      _sum: {
        amountCents: true,
      },
      _count: {
        _all: true,
      },
    });
    expect(groupBy.mock.calls[0]?.[0].where).not.toHaveProperty("userId");
  });
});

describe("spendingTrend", () => {
  it("uses fixed RLS-scoped monthly groupBy queries and returns dense per-currency cents", async () => {
    const groupBy = vi
      .fn()
      .mockResolvedValueOnce([{ currency: "CAD", _sum: { amountCents: -1000n } }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ currency: "USD", _sum: { amountCents: -700n } }])
      .mockResolvedValueOnce([{ currency: "CAD", _sum: { amountCents: -2500n } }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { currency: "CAD", _sum: { amountCents: -4000n } },
        { currency: "USD", _sum: { amountCents: -900n } },
      ]);
    vi.mocked(withUserContext).mockImplementation(async (_userId, fn) =>
      fn({ transaction: { groupBy } } as never),
    );

    await expect(spendingTrend({ userId: "user-1", endMonth: "2026-01" })).resolves.toEqual({
      months: ["2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01"],
      currencies: [
        {
          currency: "CAD",
          totals: [
            { month: "2025-08", totalCents: 1000 },
            { month: "2025-09", totalCents: 0 },
            { month: "2025-10", totalCents: 0 },
            { month: "2025-11", totalCents: 2500 },
            { month: "2025-12", totalCents: 0 },
            { month: "2026-01", totalCents: 4000 },
          ],
        },
        {
          currency: "USD",
          totals: [
            { month: "2025-08", totalCents: 0 },
            { month: "2025-09", totalCents: 0 },
            { month: "2025-10", totalCents: 700 },
            { month: "2025-11", totalCents: 0 },
            { month: "2025-12", totalCents: 0 },
            { month: "2026-01", totalCents: 900 },
          ],
        },
      ],
    });

    expect(withUserContext).toHaveBeenCalledTimes(1);
    expect(withUserContext).toHaveBeenCalledWith("user-1", expect.any(Function));
    expect(groupBy).toHaveBeenCalledTimes(6);
    expect(groupBy.mock.calls[0]?.[0]).toEqual({
      by: ["currency"],
      where: {
        date: {
          gte: new Date("2025-08-01T00:00:00.000Z"),
          lt: new Date("2025-09-01T00:00:00.000Z"),
        },
        direction: TransactionDirection.debit,
        amountCents: {
          lt: 0,
        },
        status: {
          not: TransactionStatus.removed,
        },
      },
      _sum: {
        amountCents: true,
      },
    });
    expect(groupBy.mock.calls[5]?.[0].where.date).toEqual({
      gte: new Date("2026-01-01T00:00:00.000Z"),
      lt: new Date("2026-02-01T00:00:00.000Z"),
    });
    for (const [query] of groupBy.mock.calls) {
      expect(query.where).not.toHaveProperty("userId");
      expect(query.where).not.toHaveProperty("category");
    }
  });
});
