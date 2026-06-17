import { Category, withUserContext } from "@clarifi/shared";
import {
  aggregateCategorySpendByCurrency,
  monthRangeUtc,
  toSafeIntegerCents,
} from "../transactions/transactions.service.js";

const BUDGET_CURRENCY = "CAD";

export interface BudgetResult {
  id: string;
  category: Category;
  month: string;
  monthlyLimitCents: number;
}

export interface BudgetProgress {
  category: Category;
  month: string;
  monthlyLimitCents: number;
  spentCents: number;
  remainingCents: number;
  percentUsed: number;
  currency: string;
}

export interface BudgetsWithProgressResult {
  month: string;
  currency: string;
  budgets: BudgetProgress[];
}

export async function upsertBudget(input: {
  userId: string;
  category: Category;
  month: string;
  monthlyLimitCents: number;
}): Promise<BudgetResult> {
  const monthlyLimitCents = BigInt(input.monthlyLimitCents);
  const budget = await withUserContext(input.userId, (tx) =>
    tx.budget.upsert({
      where: {
        userId_category_month: {
          userId: input.userId,
          category: input.category,
          month: input.month,
        },
      },
      create: {
        userId: input.userId,
        category: input.category,
        month: input.month,
        monthlyLimitCents,
      },
      update: {
        monthlyLimitCents,
      },
      select: {
        id: true,
        category: true,
        month: true,
        monthlyLimitCents: true,
      },
    }),
  );

  return {
    id: budget.id,
    category: budget.category,
    month: budget.month,
    monthlyLimitCents: toSafeIntegerCents(budget.monthlyLimitCents),
  };
}

export async function budgetsWithProgress(input: {
  userId: string;
  month: string;
}): Promise<BudgetsWithProgressResult> {
  const range = monthRangeUtc(input.month);
  const { budgets, categorySpendRows } = await withUserContext(input.userId, async (tx) => {
    const budgets = await tx.budget.findMany({
      where: {
        month: input.month,
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
    const categorySpendRows = await aggregateCategorySpendByCurrency(tx, range);
    return { budgets, categorySpendRows };
  });

  const cadSpendByCategory = new Map<Category, bigint>();
  for (const row of categorySpendRows) {
    if (row.currency !== BUDGET_CURRENCY) continue;
    cadSpendByCategory.set(row.category, row.totalCents);
  }

  return {
    month: input.month,
    currency: BUDGET_CURRENCY,
    budgets: budgets
      .map((budget) => {
        const monthlyLimitCents = toSafeIntegerCents(budget.monthlyLimitCents);
        const spentCents = toSafeIntegerCents(cadSpendByCategory.get(budget.category) ?? 0n);
        return {
          category: budget.category,
          month: budget.month,
          monthlyLimitCents,
          spentCents,
          remainingCents: monthlyLimitCents - spentCents,
          percentUsed: percentUsed(spentCents, monthlyLimitCents),
          currency: BUDGET_CURRENCY,
        };
      })
      .sort((a, b) => a.category.localeCompare(b.category)),
  };
}

function percentUsed(spentCents: number, monthlyLimitCents: number): number {
  if (monthlyLimitCents === 0) return 0;
  const numerator = BigInt(spentCents) * 100n;
  const denominator = BigInt(monthlyLimitCents);
  return Number((numerator + denominator / 2n) / denominator);
}
