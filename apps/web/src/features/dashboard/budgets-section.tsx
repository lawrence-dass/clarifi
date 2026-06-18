"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format-money";
import { barWidth, hasBudgets } from "./dashboard-utils";
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
          <div key={`${budget.category}-${budget.month}`} className="rounded-md border border-slate-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium text-slate-950">{categoryLabel(budget.category)}</p>
                <p className="text-sm text-slate-500">{budget.percentUsed}% used</p>
              </div>
              <div className="text-right text-sm text-slate-600">
                <p>{formatMoney(budget.spentCents, budget.currency)} spent</p>
                <p>{formatMoney(budget.remainingCents, budget.currency)} remaining</p>
              </div>
            </div>
            <div className="mt-3 h-2 rounded-full bg-slate-100" aria-label={`${categoryLabel(budget.category)} budget progress`}>
              <div className="h-2 rounded-full bg-teal-700" style={{ width: barWidth(budget.percentUsed) }} />
            </div>
            <p className="mt-2 text-xs text-slate-500">Limit {formatMoney(budget.monthlyLimitCents, budget.currency)}</p>
          </div>
        ))}
      </div>
    </SectionFrame>
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
    <form className="mt-6 grid gap-3 rounded-md border border-slate-200 p-4 sm:grid-cols-[1fr_1fr_auto]" onSubmit={form.handleSubmit(onSubmit)}>
      <label className="grid gap-1 text-sm text-slate-600">
        Category
        <select
          className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950"
          {...form.register("category")}
        >
          {CATEGORY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm text-slate-600">
        Monthly limit, cents
        <Input inputMode="numeric" type="number" min={1} step={1} {...form.register("monthlyLimitCents")} />
      </label>
      <div className="flex items-end">
        <Button type="submit" disabled={isPending} className="w-full sm:w-auto">
          Set budget
        </Button>
      </div>
      {form.formState.errors.monthlyLimitCents ? (
        <p className="text-sm text-red-700 sm:col-span-3">{form.formState.errors.monthlyLimitCents.message}</p>
      ) : null}
      {error ? (
        <div className="sm:col-span-3">
          <ErrorState error={error} />
        </div>
      ) : null}
    </form>
  );
}
