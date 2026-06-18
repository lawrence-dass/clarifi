"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatMoney } from "@/lib/format-money";
import { categoryBreakdownBucket } from "./dashboard-utils";
import { useCategoryBreakdown } from "./hooks";
import { SectionFrame } from "./section-frame";
import { categoryLabel } from "./types";

const COLORS = ["#0f766e", "#2563eb", "#9333ea", "#ea580c", "#be123c", "#4f46e5", "#64748b"];

export function CategoryBreakdownSection({ month, currency }: { month: string; currency: string }) {
  const query = useCategoryBreakdown(month);
  const bucket = categoryBreakdownBucket(query.data, currency);
  const categories = bucket?.categories ?? [];
  const chartData = categories.map((category) => ({
    name: categoryLabel(category.category),
    totalCents: category.totalCents,
    transactionCount: category.transactionCount,
  }));

  return (
    <SectionFrame
      title="Category breakdown"
      isPending={query.isPending}
      error={query.error}
      isEmpty={!chartData.length}
      emptyMessage={`No ${currency} category spending for ${month}.`}
    >
      <div aria-label={`Category breakdown for ${currency} in ${month}`} className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              dataKey="totalCents"
              nameKey="name"
              innerRadius={58}
              outerRadius={90}
              paddingAngle={2}
            >
              {chartData.map((entry, index) => (
                <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(value) => formatMoney(Number(value), currency)} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-4 divide-y divide-slate-100 text-sm">
        {categories.map((category) => (
          <li key={category.category} className="flex items-center justify-between gap-3 py-2">
            <span className="text-slate-600">{categoryLabel(category.category)}</span>
            <span className="font-medium text-slate-950">
              {formatMoney(category.totalCents, currency)} · {category.transactionCount}
            </span>
          </li>
        ))}
      </ul>
    </SectionFrame>
  );
}
