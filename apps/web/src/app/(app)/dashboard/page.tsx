"use client";

import { useEffect, useMemo, useState } from "react";
import { AnomalyInsightsSection } from "@/features/dashboard/anomaly-insights-section";
import { BudgetsSection } from "@/features/dashboard/budgets-section";
import { CashFlowSummarySection } from "@/features/dashboard/cash-flow-summary-section";
import { CategoryBreakdownSection } from "@/features/dashboard/category-breakdown-section";
import { currencyOptions, currentMonth } from "@/features/dashboard/dashboard-utils";
import {
  useCashFlowSummary,
  useCategoryBreakdown,
  useSpendingTrend,
} from "@/features/dashboard/hooks";
import { SpendingTrendSection } from "@/features/dashboard/spending-trend-section";

export default function DashboardPage() {
  const [month, setMonth] = useState(currentMonth);
  const [currency, setCurrency] = useState("CAD");
  const breakdown = useCategoryBreakdown(month);
  const trend = useSpendingTrend(month);
  const summary = useCashFlowSummary(month);
  const currencies = useMemo(
    () => currencyOptions(breakdown.data, trend.data, summary.data),
    [breakdown.data, trend.data, summary.data],
  );

  useEffect(() => {
    if (!currencies.length) return;
    if (currencies.includes(currency)) return;
    setCurrency(currencies.includes("CAD") ? "CAD" : currencies[0]!);
  }, [currencies, currency]);

  const selectedCurrency = currencies.includes(currency) ? currency : "CAD";

  return (
    <div className="grid gap-6">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text">Spending dashboard</h1>
          <p className="mt-1 text-sm text-text-muted">
            Category breakdown, six-month trend, cash flow, and CAD budget progress.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="grid gap-1">
            <span className="label-micro">Month</span>
            <input
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              className="h-10 rounded-sm border border-border bg-surface px-3 text-sm text-text focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>
          {currencies.length > 1 ? (
            <label className="grid gap-1">
              <span className="label-micro">Currency</span>
              <select
                value={selectedCurrency}
                onChange={(event) => setCurrency(event.target.value)}
                className="h-10 rounded-sm border border-border bg-surface px-3 text-sm text-text focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {currencies.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </section>

      <AnomalyInsightsSection />

      <div className="grid gap-6 xl:grid-cols-2">
        <CategoryBreakdownSection month={month} currency={selectedCurrency} />
        <SpendingTrendSection endMonth={month} currency={selectedCurrency} />
      </div>
      <CashFlowSummarySection month={month} currency={selectedCurrency} />
      <section id="budgets" className="scroll-mt-24">
        <BudgetsSection month={month} />
      </section>
    </div>
  );
}
