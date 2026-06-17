import { beforeEach, describe, expect, it, vi } from "vitest";
import { Category, TransactionDirection, TransactionStatus, withUserContext } from "@clarifi/shared";
import { cashFlowSummary, categoryBreakdown, spendingTrend } from "./transactions.service.js";

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

describe("cashFlowSummary", () => {
  it("keeps netCents signed for expense-only months and rolls previousMonth across years", async () => {
    const groupBy = vi
      .fn()
      .mockResolvedValueOnce([
        { currency: "CAD", direction: TransactionDirection.debit, _sum: { amountCents: -4200n } },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    vi.mocked(withUserContext).mockImplementation(async (_userId, fn) =>
      fn({ transaction: { groupBy } } as never),
    );

    await expect(cashFlowSummary({ userId: "user-1", month: "2026-01" })).resolves.toEqual({
      month: "2026-01",
      previousMonth: "2025-12",
      currencies: [
        {
          currency: "CAD",
          incomeCents: 0,
          expensesCents: 4200,
          netCents: -4200,
          topMerchants: [],
          categoryDeltas: [],
        },
      ],
    });
  });

  it("uses one RLS context and preserves signed net and category delta math per currency", async () => {
    const groupBy = vi
      .fn()
      .mockResolvedValueOnce([
        { currency: "CAD", direction: TransactionDirection.credit, _sum: { amountCents: 500000n } },
        { currency: "CAD", direction: TransactionDirection.debit, _sum: { amountCents: -12500n } },
        { currency: "USD", direction: TransactionDirection.credit, _sum: { amountCents: 20000n } },
        { currency: "USD", direction: TransactionDirection.debit, _sum: { amountCents: -5000n } },
      ])
      .mockResolvedValueOnce([
        { currency: "CAD", merchantName: "Uber", _sum: { amountCents: -4000n }, _count: { _all: 1 } },
        { currency: "CAD", merchantName: "Loblaws", _sum: { amountCents: -3500n }, _count: { _all: 2 } },
        { currency: "CAD", merchantName: "Tiny", _sum: { amountCents: -100n }, _count: { _all: 1 } },
        { currency: "USD", merchantName: "US Store", _sum: { amountCents: -5000n }, _count: { _all: 1 } },
      ])
      .mockResolvedValueOnce([
        { currency: "CAD", category: Category.food_and_dining, _sum: { amountCents: -5700n }, _count: { _all: 3 } },
        { currency: "CAD", category: Category.transport, _sum: { amountCents: -4000n }, _count: { _all: 1 } },
        { currency: "CAD", category: Category.shopping, _sum: { amountCents: -900n }, _count: { _all: 2 } },
        { currency: "USD", category: Category.travel, _sum: { amountCents: -5000n }, _count: { _all: 1 } },
      ])
      .mockResolvedValueOnce([
        { currency: "CAD", category: Category.food_and_dining, _sum: { amountCents: -5000n }, _count: { _all: 1 } },
        { currency: "CAD", category: Category.shopping, _sum: { amountCents: -2000n }, _count: { _all: 1 } },
        { currency: "CAD", category: Category.travel, _sum: { amountCents: -1300n }, _count: { _all: 1 } },
      ]);
    vi.mocked(withUserContext).mockImplementation(async (_userId, fn) =>
      fn({ transaction: { groupBy } } as never),
    );

    await expect(cashFlowSummary({ userId: "user-1", month: "2026-06" })).resolves.toEqual({
      month: "2026-06",
      previousMonth: "2026-05",
      currencies: [
        {
          currency: "CAD",
          incomeCents: 500000,
          expensesCents: 12500,
          netCents: 487500,
          topMerchants: [
            { merchantName: "Uber", totalCents: 4000, transactionCount: 1 },
            { merchantName: "Loblaws", totalCents: 3500, transactionCount: 2 },
            { merchantName: "Tiny", totalCents: 100, transactionCount: 1 },
          ],
          categoryDeltas: [
            { category: Category.food_and_dining, currentCents: 5700, previousCents: 5000, deltaCents: 700 },
            { category: Category.transport, currentCents: 4000, previousCents: 0, deltaCents: 4000 },
            { category: Category.shopping, currentCents: 900, previousCents: 2000, deltaCents: -1100 },
            { category: Category.travel, currentCents: 0, previousCents: 1300, deltaCents: -1300 },
          ],
        },
        {
          currency: "USD",
          incomeCents: 20000,
          expensesCents: 5000,
          netCents: 15000,
          topMerchants: [
            { merchantName: "US Store", totalCents: 5000, transactionCount: 1 },
          ],
          categoryDeltas: [
            { category: Category.travel, currentCents: 5000, previousCents: 0, deltaCents: 5000 },
          ],
        },
      ],
    });

    expect(withUserContext).toHaveBeenCalledTimes(1);
    expect(withUserContext).toHaveBeenCalledWith("user-1", expect.any(Function));
    expect(groupBy).toHaveBeenCalledTimes(4);
    expect(groupBy.mock.calls[0]?.[0]).toEqual({
      by: ["currency", "direction"],
      where: {
        date: {
          gte: new Date("2026-06-01T00:00:00.000Z"),
          lt: new Date("2026-07-01T00:00:00.000Z"),
        },
        status: {
          not: TransactionStatus.removed,
        },
        OR: [
          {
            direction: TransactionDirection.credit,
            amountCents: {
              gt: 0,
            },
          },
          {
            direction: TransactionDirection.debit,
            amountCents: {
              lt: 0,
            },
          },
        ],
      },
      _sum: {
        amountCents: true,
      },
    });
    expect(groupBy.mock.calls[1]?.[0]).toEqual({
      by: ["currency", "merchantName"],
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
        merchantName: {
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
    expect(groupBy.mock.calls[2]?.[0].where.date).toEqual({
      gte: new Date("2026-06-01T00:00:00.000Z"),
      lt: new Date("2026-07-01T00:00:00.000Z"),
    });
    expect(groupBy.mock.calls[3]?.[0].where.date).toEqual({
      gte: new Date("2026-05-01T00:00:00.000Z"),
      lt: new Date("2026-06-01T00:00:00.000Z"),
    });
    for (const [query] of groupBy.mock.calls) {
      expect(query.where).not.toHaveProperty("userId");
    }
  });
});
