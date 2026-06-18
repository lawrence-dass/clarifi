import { z } from "zod";

export const CategorySchema = z.enum([
  "food_and_dining",
  "transport",
  "housing",
  "utilities",
  "shopping",
  "entertainment",
  "health",
  "travel",
  "income",
  "transfers",
  "other",
]);

export type Category = z.infer<typeof CategorySchema>;

export const CATEGORY_OPTIONS: ReadonlyArray<{ value: Category; label: string }> = [
  { value: "food_and_dining", label: "Food & dining" },
  { value: "transport", label: "Transport" },
  { value: "housing", label: "Housing" },
  { value: "utilities", label: "Utilities" },
  { value: "shopping", label: "Shopping" },
  { value: "entertainment", label: "Entertainment" },
  { value: "health", label: "Health" },
  { value: "travel", label: "Travel" },
  { value: "income", label: "Income" },
  { value: "transfers", label: "Transfers" },
  { value: "other", label: "Other" },
];

export function categoryLabel(category: Category): string {
  return CATEGORY_OPTIONS.find((option) => option.value === category)?.label ?? category;
}

export interface CategoryBreakdownResult {
  month: string;
  currencies: Array<{
    currency: string;
    totalCents: number;
    categories: Array<{
      category: Category;
      totalCents: number;
      transactionCount: number;
    }>;
  }>;
}

export interface SpendingTrendResult {
  months: string[];
  currencies: Array<{
    currency: string;
    totals: Array<{
      month: string;
      totalCents: number;
    }>;
  }>;
}

export interface CashFlowSummaryResult {
  month: string;
  previousMonth: string;
  currencies: Array<{
    currency: string;
    incomeCents: number;
    expensesCents: number;
    netCents: number;
    topMerchants: Array<{
      merchantName: string;
      totalCents: number;
      transactionCount: number;
    }>;
    categoryDeltas: Array<{
      category: Category;
      currentCents: number;
      previousCents: number;
      deltaCents: number;
    }>;
  }>;
}

export interface BudgetsResult {
  month: string;
  currency: "CAD";
  budgets: BudgetProgress[];
}

export interface BudgetProgress {
  category: Category;
  month: string;
  monthlyLimitCents: number;
  spentCents: number;
  remainingCents: number;
  percentUsed: number;
  currency: "CAD";
}

export interface PutBudgetResult {
  id: string;
  category: Category;
  month: string;
  monthlyLimitCents: number;
}
