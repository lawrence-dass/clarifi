"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCriticalAnomalies, useDismissAnomaly } from "./notification.hooks";
import type { NotificationAnomaly } from "./notification.types";

function formatAmount(cents: number, currency: string): string {
  return `${currency} $${(Math.abs(cents) / 100).toFixed(2)}`;
}

function anomalySummary(anomaly: NotificationAnomaly): string {
  if (anomaly.explanation) return anomaly.explanation;
  const merchant = anomaly.transaction.merchantName ?? "Unknown merchant";
  const amount = formatAmount(anomaly.transaction.amountCents, anomaly.transaction.currency);
  switch (anomaly.type) {
    case "velocity": return `Repeated charges at ${merchant}`;
    case "merchant": return `New merchant: ${merchant} (${amount})`;
    default: return `Unusual ${amount} charge at ${merchant}`;
  }
}

function AnomalyItem({ anomaly, onDismiss }: { anomaly: NotificationAnomaly; onDismiss: () => void }) {
  return (
    <div className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-0">
      <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-text leading-snug">{anomalySummary(anomaly)}</p>
        <p className="mt-0.5 text-xs text-text-faint">
          {anomaly.transaction.merchantName ?? "—"} ·{" "}
          {new Date(anomaly.transaction.date).toLocaleDateString("en-CA")}
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="shrink-0 text-text-faint hover:text-text"
      >
        ✕
      </Button>
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
        className="relative rounded px-3 py-2 text-text-muted hover:bg-canvas hover:text-text"
        aria-label={`${count} critical anomaly notification${count === 1 ? "" : "s"}`}
      >
        <span aria-hidden>🔔</span>
        {count > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-danger text-[10px] font-bold text-white">
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 z-20 mt-1 w-80 rounded border border-border bg-surface shadow-modal">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <p className="text-sm font-semibold text-text">Critical alerts</p>
              {count > 0 ? (
                <Badge tone="danger">{count} unreviewed</Badge>
              ) : (
                <Badge tone="success">All clear</Badge>
              )}
            </div>
            {count === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-text-muted">
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
