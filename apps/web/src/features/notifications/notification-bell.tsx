"use client";

import { useState } from "react";
import { useCriticalAnomalies, useDismissAnomaly } from "./notification.hooks";
import type { NotificationAnomaly } from "./notification.types";

function formatAmount(cents: number, currency: string): string {
  const dollars = Math.abs(cents) / 100;
  return `${currency} $${dollars.toFixed(2)}`;
}

function anomalySummary(anomaly: NotificationAnomaly): string {
  if (anomaly.explanation) return anomaly.explanation;
  const merchant = anomaly.transaction.merchantName ?? "Unknown merchant";
  const amount = formatAmount(anomaly.transaction.amountCents, anomaly.transaction.currency);
  switch (anomaly.type) {
    case "velocity":
      return `Repeated charges at ${merchant}`;
    case "merchant":
      return `New merchant: ${merchant} (${amount})`;
    default:
      return `Unusual ${amount} charge at ${merchant}`;
  }
}

function AnomalyItem({ anomaly, onDismiss }: { anomaly: NotificationAnomaly; onDismiss: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-950 leading-snug">{anomalySummary(anomaly)}</p>
        <p className="mt-0.5 text-xs text-slate-400">
          {anomaly.transaction.merchantName ?? "—"} ·{" "}
          {new Date(anomaly.transaction.date).toLocaleDateString("en-CA")}
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 text-xs text-slate-400 hover:text-slate-600"
        aria-label="Dismiss notification"
      >
        ✕
      </button>
    </div>
  );
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data } = useCriticalAnomalies();
  const dismiss = useDismissAnomaly();

  const anomalies = data?.anomalies ?? [];
  const count = anomalies.length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="relative rounded-md px-3 py-2 text-slate-600 hover:bg-slate-100 hover:text-slate-950"
        aria-label={`${count} critical anomaly notification${count === 1 ? "" : "s"}`}
      >
        <span aria-hidden>🔔</span>
        {count > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white">
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute right-0 z-20 mt-1 w-80 rounded-md border border-slate-200 bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <p className="text-sm font-medium text-slate-950">Critical alerts</p>
              {count === 0 ? (
                <span className="text-xs text-slate-400">All clear</span>
              ) : (
                <span className="text-xs text-slate-400">{count} unreviewed</span>
              )}
            </div>
            {count === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-400">
                No critical anomalies detected.
              </p>
            ) : (
              <div className="max-h-80 overflow-y-auto">
                {anomalies.map((anomaly) => (
                  <AnomalyItem
                    key={anomaly.id}
                    anomaly={anomaly}
                    onDismiss={() => dismiss.mutate(anomaly.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
