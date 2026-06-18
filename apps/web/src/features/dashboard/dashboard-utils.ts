import type {
  BudgetsResult,
  CashFlowSummaryResult,
  CategoryBreakdownResult,
  SpendingTrendResult,
} from "./types";

export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function currencyOptions(
  breakdown?: CategoryBreakdownResult,
  trend?: SpendingTrendResult,
  summary?: CashFlowSummaryResult,
): string[] {
  const currencies = new Set<string>();
  for (const bucket of breakdown?.currencies ?? []) currencies.add(bucket.currency);
  for (const bucket of trend?.currencies ?? []) currencies.add(bucket.currency);
  for (const bucket of summary?.currencies ?? []) currencies.add(bucket.currency);
  return [...currencies].sort((a, b) => (a === "CAD" ? -1 : b === "CAD" ? 1 : a.localeCompare(b)));
}

export function categoryBreakdownBucket(data: CategoryBreakdownResult | undefined, currency: string) {
  return data?.currencies.find((bucket) => bucket.currency === currency);
}

export function trendBucket(data: SpendingTrendResult | undefined, currency: string) {
  return data?.currencies.find((bucket) => bucket.currency === currency);
}

export function summaryBucket(data: CashFlowSummaryResult | undefined, currency: string) {
  return data?.currencies.find((bucket) => bucket.currency === currency);
}

export function hasBudgets(data: BudgetsResult | undefined): boolean {
  return Boolean(data?.budgets.length);
}

export function barWidth(percentUsed: number): string {
  return `${Math.min(Math.max(percentUsed, 0), 100)}%`;
}
