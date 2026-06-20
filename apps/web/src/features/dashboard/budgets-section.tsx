"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { formatMoney } from "@/lib/format-money";
import { hasBudgets } from "./dashboard-utils";
import type { BudgetProgress } from "./types";
import { useBudgets, usePutBudget } from "./hooks";
import { SectionFrame } from "./section-frame";
import { CATEGORY_OPTIONS, CategorySchema, categoryLabel } from "./types";

const BudgetFormSchema = z.object({
  category: CategorySchema,
  monthlyLimitCents: z.coerce.number().int().positive(),
});

type BudgetFormValues = z.infer<typeof BudgetFormSchema>;

export function BudgetsSection({ month }: { month: string }) {
  const query = useBudgets(month);
  const putBudget = usePutBudget(month);
  const form = useForm<BudgetFormValues>({
    resolver: zodResolver(BudgetFormSchema),
    defaultValues: {
      category: "food_and_dining",
      monthlyLimitCents: 10000,
    },
  });

  async function submit(values: BudgetFormValues) {
    await putBudget.mutateAsync({ ...values, month });
  }

  return (
    <SectionFrame
      title="Budgets"
      isPending={query.isPending}
      error={query.error}
      isEmpty={!hasBudgets(query.data)}
      emptyMessage={`No CAD budgets set for ${month}. Use the form below to create one.`}
      footer={
        <BudgetForm
          form={form}
          isPending={putBudget.isPending}
          error={putBudget.error}
          onSubmit={submit}
        />
      }
    >
      <div className="space-y-4">
        {query.data?.budgets.map((budget) => (
          <BudgetCard key={`${budget.category}-${budget.month}`} budget={budget} />
        ))}
      </div>
    </SectionFrame>
  );
}

function budgetTone(pct: number): "success" | "warning" | "danger" {
  if (pct >= 100) return "danger";
  if (pct >= 80) return "warning";
  return "success";
}

function budgetAlertMessage(pct: number): string | null {
  if (pct >= 100) return "Over budget";
  if (pct >= 80) return "Approaching limit";
  return null;
}

function BudgetCard({ budget }: { budget: BudgetProgress }) {
  const tone = budgetTone(budget.percentUsed);
  const alert = budgetAlertMessage(budget.percentUsed);

  return (
    <div className="rounded border border-border bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium text-text">{categoryLabel(budget.category)}</p>
          {alert ? (
            <p
              className={`text-xs font-semibold ${tone === "danger" ? "text-danger" : "text-warning"}`}
            >
              {alert}
            </p>
          ) : null}
        </div>
        <div className="text-right text-sm text-text-muted tabular-nums">
          <p>{formatMoney(budget.spentCents, budget.currency)} spent</p>
          <p>{formatMoney(budget.remainingCents, budget.currency)} remaining</p>
        </div>
      </div>
      <Progress
        value={budget.percentUsed}
        tone={tone}
        showValue
        className="mt-3"
        aria-label={`${categoryLabel(budget.category)} budget progress`}
      />
      <p className="mt-1.5 text-xs text-text-faint">
        Limit {formatMoney(budget.monthlyLimitCents, budget.currency)}
      </p>
    </div>
  );
}

function BudgetForm({
  form,
  isPending,
  error,
  onSubmit,
}: {
  form: ReturnType<typeof useForm<BudgetFormValues>>;
  isPending: boolean;
  error: unknown;
  onSubmit: (values: BudgetFormValues) => Promise<void>;
}) {
  return (
    <form
      className="mt-6 grid gap-3 rounded border border-border bg-canvas p-4 sm:grid-cols-[1fr_1fr_auto]"
      onSubmit={form.handleSubmit(onSubmit)}
    >
      <label className="grid gap-1">
        <span className="label-micro">Category</span>
        <select
          className="h-10 rounded-sm border border-border bg-surface px-3 text-sm text-text focus:outline-none focus:ring-1 focus:ring-primary"
          {...form.register("category")}
        >
          {CATEGORY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1">
        <span className="label-micro">Monthly limit, cents</span>
        <Input inputMode="numeric" type="number" min={1} step={1} {...form.register("monthlyLimitCents")} />
      </label>
      <div className="flex items-end">
        <Button type="submit" disabled={isPending} className="w-full sm:w-auto">
          Set budget
        </Button>
      </div>
      {form.formState.errors.monthlyLimitCents ? (
        <p className="text-sm text-danger sm:col-span-3">
          {form.formState.errors.monthlyLimitCents.message}
        </p>
      ) : null}
      {error ? (
        <div className="sm:col-span-3">
          <ErrorState error={error} />
        </div>
      ) : null}
    </form>
  );
}
