"use client";

import { formatMoney } from "@/lib/format-money";
import { summaryBucket } from "./dashboard-utils";
import { useCashFlowSummary } from "./hooks";
import { SectionFrame } from "./section-frame";
import { categoryLabel } from "./types";

export function CashFlowSummarySection({ month, currency }: { month: string; currency: string }) {
  const query = useCashFlowSummary(month);
  const bucket = summaryBucket(query.data, currency);

  return (
    <SectionFrame
      title="Cash-flow summary"
      isPending={query.isPending}
      error={query.error}
      isEmpty={!bucket}
      emptyMessage={`No ${currency} cash-flow summary for ${month}.`}
    >
      {bucket ? (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="Income" value={formatMoney(bucket.incomeCents, currency)} />
            <Metric label="Expenses" value={formatMoney(bucket.expensesCents, currency)} />
            <Metric label="Net" value={formatMoney(bucket.netCents, currency)} tone={bucket.netCents < 0 ? "red" : "green"} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="text-sm font-medium text-slate-950">Top merchants</h3>
              {bucket.topMerchants.length ? (
                <ul className="mt-3 divide-y divide-slate-100 text-sm">
                  {bucket.topMerchants.map((merchant) => (
                    <li key={merchant.merchantName} className="flex items-center justify-between gap-3 py-2">
                      <span className="text-slate-600">{merchant.merchantName}</span>
                      <span className="font-medium text-slate-950">
                        {formatMoney(merchant.totalCents, currency)} · {merchant.transactionCount}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-slate-500">No merchants for this month.</p>
              )}
            </div>

            <div>
              <h3 className="text-sm font-medium text-slate-950">
                Category deltas from {query.data?.previousMonth}
              </h3>
              {bucket.categoryDeltas.length ? (
                <ul className="mt-3 divide-y divide-slate-100 text-sm">
                  {bucket.categoryDeltas.map((delta) => (
                    <li key={delta.category} className="flex items-center justify-between gap-3 py-2">
                      <span className="text-slate-600">{categoryLabel(delta.category)}</span>
                      <span className={`font-medium ${deltaTone(delta.deltaCents)}`}>
                        {deltaIcon(delta.deltaCents)}{" "}
                        {formatMoney(delta.deltaCents, currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-slate-500">No category deltas for this month.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </SectionFrame>
  );
}

function deltaIcon(deltaCents: number): string {
  if (deltaCents < 0) return "↓";
  if (deltaCents > 0) return "↑";
  return "→";
}

function deltaTone(deltaCents: number): string {
  if (deltaCents < 0) return "text-emerald-700";
  if (deltaCents > 0) return "text-rose-700";
  return "text-slate-600";
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "green" | "red" }) {
  const toneClass = tone === "red" ? "text-rose-700" : tone === "green" ? "text-emerald-700" : "text-slate-950";
  return (
    <div className="rounded-md border border-slate-200 px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}
