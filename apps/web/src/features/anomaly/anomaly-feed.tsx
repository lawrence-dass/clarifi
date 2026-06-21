"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/error-state";
import { Loading } from "@/components/loading";
import { formatMoney } from "@/lib/format-money";
import type { NotificationAnomaly } from "@/features/notifications/notification.types";
import { useAnomalies, useDismissAnomaly, useReportAnomaly } from "./anomaly.hooks";

function severityTone(severity: NotificationAnomaly["severity"]) {
  if (severity === "critical") return "danger" as const;
  if (severity === "warning") return "warning" as const;
  return "info" as const;
}

function severityBorderClass(severity: NotificationAnomaly["severity"]) {
  if (severity === "critical") return "border-l-danger";
  if (severity === "warning") return "border-l-warning";
  return "border-l-info";
}

// Anomalies are shown as a magnitude (e.g. "a $120.00 charge"); format via the
// shared display formatter so locale/currency match the rest of the app.
function formatAmount(cents: number, currency: string): string {
  return formatMoney(Math.abs(cents), currency);
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

function AnomalyRow({ anomaly }: { anomaly: NotificationAnomaly }) {
  const dismiss = useDismissAnomaly();
  const report = useReportAnomaly();
  const tone = severityTone(anomaly.severity);
  const borderClass = severityBorderClass(anomaly.severity);

  return (
    <div
      className={`flex items-start gap-4 rounded border border-border bg-surface p-4 shadow-card border-l-4 ${borderClass} ${anomaly.dismissed ? "opacity-50" : ""}`}
    >
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={tone}>{anomaly.severity}</Badge>
          <span className="text-xs text-text-faint">
            {new Date(anomaly.transaction.date).toLocaleDateString("en-CA")}
          </span>
          {anomaly.transaction.merchantName ? (
            <span className="text-xs text-text-muted">{anomaly.transaction.merchantName}</span>
          ) : null}
        </div>
        <p className="text-sm text-text leading-snug">{anomalySummary(anomaly)}</p>
        {anomaly.transaction.amountCents !== 0 ? (
          <p className="text-xs text-text-muted tabular-nums">
            {formatAmount(anomaly.transaction.amountCents, anomaly.transaction.currency)}
          </p>
        ) : null}
      </div>
      {!anomaly.dismissed ? (
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => report.mutate(anomaly.id)}
            disabled={report.isPending}
          >
            Report
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => dismiss.mutate(anomaly.id)}
            disabled={dismiss.isPending}
          >
            Dismiss
          </Button>
        </div>
      ) : (
        <span className="text-xs text-text-faint shrink-0">Dismissed</span>
      )}
    </div>
  );
}

export function AnomalyFeed() {
  const { data, isPending, error } = useAnomalies();
  const anomalies = data?.anomalies ?? [];

  if (isPending) return <Loading label="Loading anomalies" />;
  if (error) return <ErrorState error={error} />;
  if (!anomalies.length) {
    return (
      <div className="rounded border border-dashed border-border px-6 py-12 text-center">
        <p className="text-sm font-medium text-text">No anomalies detected</p>
        <p className="mt-1 text-xs text-text-muted">Your spending patterns look normal.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {anomalies.map((anomaly) => (
        <AnomalyRow key={anomaly.id} anomaly={anomaly} />
      ))}
    </div>
  );
}
