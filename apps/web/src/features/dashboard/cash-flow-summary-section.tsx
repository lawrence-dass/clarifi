"use client";

import { KpiTile } from "@/components/ui/kpi-tile";
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
            <KpiTile
              label="Income"
              value={formatMoney(bucket.incomeCents, currency)}
              currency={currency}
            />
            <KpiTile
              label="Expenses"
              value={formatMoney(bucket.expensesCents, currency)}
              currency={currency}
            />
            <KpiTile
              label="Net"
              value={formatMoney(bucket.netCents, currency)}
              currency={currency}
              delta={
                bucket.netCents !== 0
                  ? { direction: bucket.netCents > 0 ? "up" : "down", label: "" }
                  : undefined
              }
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <p className="label-micro mb-3">Top merchants</p>
              {bucket.topMerchants.length ? (
                <ul className="divide-y divide-border text-sm">
                  {bucket.topMerchants.map((merchant) => (
                    <li key={merchant.merchantName} className="flex items-center justify-between gap-3 py-2.5">
                      <span className="text-text-muted">{merchant.merchantName}</span>
                      <span className="font-medium text-text tabular-nums">
                        {formatMoney(merchant.totalCents, currency)} · {merchant.transactionCount}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-text-muted">No merchants for this month.</p>
              )}
            </div>

            <div>
              <p className="label-micro mb-3">
                Category deltas from {query.data?.previousMonth}
              </p>
              {bucket.categoryDeltas.length ? (
                <ul className="divide-y divide-border text-sm">
                  {bucket.categoryDeltas.map((delta) => (
                    <li key={delta.category} className="flex items-center justify-between gap-3 py-2.5">
                      <span className="text-text-muted">{categoryLabel(delta.category)}</span>
                      <span className={`font-medium tabular-nums ${deltaTone(delta.deltaCents)}`}>
                        {deltaIcon(delta.deltaCents)}{" "}
                        {formatMoney(delta.deltaCents, currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-text-muted">No category deltas for this month.</p>
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
  if (deltaCents < 0) return "text-success";
  if (deltaCents > 0) return "text-danger";
  return "text-text-muted";
}
