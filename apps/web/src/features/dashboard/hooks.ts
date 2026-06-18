import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type {
  BudgetsResult,
  CashFlowSummaryResult,
  Category,
  CategoryBreakdownResult,
  PutBudgetResult,
  SpendingTrendResult,
} from "./types";

export const dashboardKeys = {
  categoryBreakdown: (month: string) => ["category-breakdown", { month }] as const,
  spendingTrend: (endMonth: string) => ["spending-trend", { endMonth }] as const,
  summary: (month: string) => ["summary", { month }] as const,
  budgets: (month: string) => ["budgets", { month }] as const,
};

export function useCategoryBreakdown(month: string) {
  return useQuery({
    queryKey: dashboardKeys.categoryBreakdown(month),
    queryFn: () =>
      apiClient<CategoryBreakdownResult>(`/transactions/category-breakdown?${new URLSearchParams({ month })}`),
  });
}

export function useSpendingTrend(endMonth: string) {
  return useQuery({
    queryKey: dashboardKeys.spendingTrend(endMonth),
    queryFn: () =>
      apiClient<SpendingTrendResult>(`/transactions/spending-trend?${new URLSearchParams({ endMonth })}`),
  });
}

export function useCashFlowSummary(month: string) {
  return useQuery({
    queryKey: dashboardKeys.summary(month),
    queryFn: () => apiClient<CashFlowSummaryResult>(`/transactions/summary?${new URLSearchParams({ month })}`),
  });
}

export function useBudgets(month: string) {
  return useQuery({
    queryKey: dashboardKeys.budgets(month),
    queryFn: () => apiClient<BudgetsResult>(`/budgets?${new URLSearchParams({ month })}`),
  });
}

export function usePutBudget(month: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { category: Category; month: string; monthlyLimitCents: number }) =>
      apiClient<PutBudgetResult>("/budgets", { method: "PUT", body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.budgets(month) });
    },
  });
}
