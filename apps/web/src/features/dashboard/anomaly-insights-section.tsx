"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  anomalySummary,
  formatAmount,
  severityBorderClass,
  severityTone,
} from "@/features/anomaly/anomaly-presentation";
import { useCriticalAnomalies } from "@/features/notifications/notification.hooks";
import type { NotificationAnomaly } from "@/features/notifications/notification.types";
import { SectionFrame } from "./section-frame";

const PREVIEW_COUNT = 3;

function InsightRow({ anomaly }: { anomaly: NotificationAnomaly }) {
  return (
    <li
      className={`border-l-4 pl-3 ${severityBorderClass(anomaly.severity)}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={severityTone(anomaly.severity)}>{anomaly.severity}</Badge>
        <span className="text-xs text-text-faint">
          {new Date(anomaly.transaction.date).toLocaleDateString("en-CA")}
        </span>
        {anomaly.transaction.merchantName ? (
          <span className="text-xs text-text-muted">{anomaly.transaction.merchantName}</span>
        ) : null}
      </div>
      <p className="mt-0.5 text-sm leading-snug text-text">{anomalySummary(anomaly)}</p>
      {anomaly.transaction.amountCents !== 0 ? (
        <p className="text-xs tabular-nums text-text-muted">
          {formatAmount(anomaly.transaction.amountCents, anomaly.transaction.currency)}
        </p>
      ) : null}
    </li>
  );
}

/**
 * Glanceable dashboard summary of critical anomalies. Read-only — it reuses the
 * same `useCriticalAnomalies` query as the notification bell (shared cache, no
 * extra request, no detection or LLM work) and links to the /anomalies page for
 * the full dismiss/report triage.
 */
export function AnomalyInsightsSection() {
  const { data, isPending, error } = useCriticalAnomalies();
  const anomalies = data?.anomalies ?? [];
  const count = anomalies.length;

  return (
    <SectionFrame
      title="Anomaly insights"
      isPending={isPending}
      error={error}
      isEmpty={count === 0}
      emptyMessage="No critical anomalies — your spending looks normal."
      footer={
        <Link
          href="/anomalies"
          className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
        >
          View all anomalies →
        </Link>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-text-muted">
          <span className="font-semibold text-text tabular-nums">{count}</span> critical
          {count === 1 ? " anomaly needs" : " anomalies need"} a look.
        </p>
        <ul className="space-y-3">
          {anomalies.slice(0, PREVIEW_COUNT).map((anomaly) => (
            <InsightRow key={anomaly.id} anomaly={anomaly} />
          ))}
        </ul>
      </div>
    </SectionFrame>
  );
}
