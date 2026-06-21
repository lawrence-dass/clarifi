import { formatMoney } from "@/lib/format-money";
import type { NotificationAnomaly } from "@/features/notifications/notification.types";

// Shared presentation helpers for anomalies, used by both the full triage feed
// (AnomalyFeed) and the dashboard summary card (AnomalyInsightsSection) so the
// severity/summary logic lives in one place.

export function severityTone(severity: NotificationAnomaly["severity"]) {
  if (severity === "critical") return "danger" as const;
  if (severity === "warning") return "warning" as const;
  return "info" as const;
}

export function severityBorderClass(severity: NotificationAnomaly["severity"]) {
  if (severity === "critical") return "border-l-danger";
  if (severity === "warning") return "border-l-warning";
  return "border-l-info";
}

// Anomalies are shown as a magnitude (e.g. "a $120.00 charge"); format via the
// shared display formatter so locale/currency match the rest of the app.
export function formatAmount(cents: number, currency: string): string {
  return formatMoney(Math.abs(cents), currency);
}

export function anomalySummary(anomaly: NotificationAnomaly): string {
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
