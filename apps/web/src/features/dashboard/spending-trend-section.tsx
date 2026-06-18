"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/format-money";
import { trendBucket } from "./dashboard-utils";
import { useSpendingTrend } from "./hooks";
import { SectionFrame } from "./section-frame";

export function SpendingTrendSection({ endMonth, currency }: { endMonth: string; currency: string }) {
  const query = useSpendingTrend(endMonth);
  const bucket = trendBucket(query.data, currency);
  const totalsByMonth = new Map(bucket?.totals.map((total) => [total.month, total.totalCents]));
  const chartData = (query.data?.months ?? []).map((month) => ({
    month,
    totalCents: totalsByMonth.get(month) ?? 0,
  }));

  return (
    <SectionFrame
      title="6-month spending trend"
      isPending={query.isPending}
      error={query.error}
      isEmpty={!bucket || !chartData.length}
      emptyMessage={`No ${currency} spending trend ending ${endMonth}.`}
    >
      <div aria-label={`Six month spending trend for ${currency} ending ${endMonth}`} className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="month" tickLine={false} axisLine={false} />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => formatMoney(Number(value), currency)}
              width={82}
            />
            <Tooltip formatter={(value) => formatMoney(Number(value), currency)} />
            <Legend />
            <Line
              type="monotone"
              dataKey="totalCents"
              name="Spending"
              stroke="#0f766e"
              strokeWidth={2}
              dot={{ r: 3 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </SectionFrame>
  );
}
