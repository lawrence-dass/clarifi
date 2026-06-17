import { beforeEach, describe, expect, it, vi } from "vitest";
import { Category, withUserContext } from "@clarifi/shared";
import { budgetsWithProgress, upsertBudget } from "./budgets.service.js";

vi.mock("@clarifi/shared", async (importActual) => {
  const actual = await importActual<typeof import("@clarifi/shared")>();
  return {
    ...actual,
    withUserContext: vi.fn(),
  };
});

vi.mock("../transactions/transactions.service.js", async (importActual) => {
  const actual = await importActual<typeof import("../transactions/transactions.service.js")>();
  return {
    ...actual,
    aggregateCategorySpendByCurrency: vi.fn().mockResolvedValue([
      { currency: "CAD", category: Category.food_and_dining, totalCents: 2500n, transactionCount: 1 },
      { currency: "USD", category: Category.food_and_dining, totalCents: 9999n, transactionCount: 1 },
      { currency: "CAD", category: Category.transport, totalCents: 5000n, transactionCount: 1 },
    ]),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("upsertBudget", () => {
  it("writes inside one RLS context and uses the authenticated user id in the compound key and create data", async () => {
    const upsert = vi.fn().mockResolvedValue({
      id: "budget-1",
      category: Category.food_and_dining,
      month: "2026-06",
      monthlyLimitCents: 60000n,
    });
    vi.mocked(withUserContext).mockImplementation(async (_userId, fn) =>
      fn({ budget: { upsert } } as never),
    );

    await expect(upsertBudget({
      userId: "user-1",
      category: Category.food_and_dining,
      month: "2026-06",
      monthlyLimitCents: 60000,
    })).resolves.toEqual({
      id: "budget-1",
      category: Category.food_and_dining,
      month: "2026-06",
      monthlyLimitCents: 60000,
    });

    expect(withUserContext).toHaveBeenCalledTimes(1);
    expect(withUserContext).toHaveBeenCalledWith("user-1", expect.any(Function));
    expect(upsert).toHaveBeenCalledWith({
      where: {
        userId_category_month: {
          userId: "user-1",
          category: Category.food_and_dining,
          month: "2026-06",
        },
      },
      create: {
        userId: "user-1",
        category: Category.food_and_dining,
        month: "2026-06",
        monthlyLimitCents: 60000n,
      },
      update: {
        monthlyLimitCents: 60000n,
      },
      select: {
        id: true,
        category: true,
        month: true,
        monthlyLimitCents: true,
      },
    });
  });
});

describe("budgetsWithProgress", () => {
  it("reads budgets and spend in one RLS context, uses CAD spend only, and guards percentUsed for zero limits", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        category: Category.food_and_dining,
        month: "2026-06",
        monthlyLimitCents: 10000n,
      },
      {
        category: Category.transport,
        month: "2026-06",
        monthlyLimitCents: 0n,
      },
    ]);
    vi.mocked(withUserContext).mockImplementation(async (_userId, fn) =>
      fn({ budget: { findMany } } as never),
    );

    await expect(budgetsWithProgress({ userId: "user-1", month: "2026-06" })).resolves.toEqual({
      month: "2026-06",
      currency: "CAD",
      budgets: [
        {
          category: Category.food_and_dining,
          month: "2026-06",
          monthlyLimitCents: 10000,
          spentCents: 2500,
          remainingCents: 7500,
          percentUsed: 25,
          currency: "CAD",
        },
        {
          category: Category.transport,
          month: "2026-06",
          monthlyLimitCents: 0,
          spentCents: 5000,
          remainingCents: -5000,
          percentUsed: 0,
          currency: "CAD",
        },
      ],
    });

    expect(withUserContext).toHaveBeenCalledTimes(1);
    expect(withUserContext).toHaveBeenCalledWith("user-1", expect.any(Function));
    expect(findMany).toHaveBeenCalledWith({
      where: {
        month: "2026-06",
      },
      orderBy: {
        category: "asc",
      },
      select: {
        category: true,
        month: true,
        monthlyLimitCents: true,
      },
    });
    expect(findMany.mock.calls[0]?.[0].where).not.toHaveProperty("userId");
  });
});
