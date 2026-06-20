import type * as React from "react";
import { cn } from "@/lib/utils";
import { StatDelta, type StatDeltaProps } from "./stat-delta";

export interface KpiTileProps extends React.HTMLAttributes<HTMLDivElement> {
  /** UPPERCASE micro-label, e.g. "TOTAL SPEND". */
  label: string;
  /** Pre-formatted hero value, e.g. "$3,062.00". Format money at this layer. */
  value: React.ReactNode;
  /** Optional currency tag (CAD primary; never blend currencies). */
  currency?: string;
  delta?: { direction?: StatDeltaProps["direction"]; label: string };
  /** Optional inline visual (sparkline) rendered to the right of the value. */
  chart?: React.ReactNode;
}

/**
 * KPI / metric tile — the hero pattern from the reference dashboards:
 * UPPERCASE label → large value → colored delta, with an optional sparkline.
 * See docs/design-reference.md §5.1.
 */
export function KpiTile({
  label,
  value,
  currency,
  delta,
  chart,
  className,
  ...props
}: KpiTileProps) {
  return (
    <div
      className={cn("rounded-md border border-border bg-surface p-5 shadow-card", className)}
      {...props}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="label-micro">{label}</span>
        {currency ? <span className="text-xs text-text-faint">{currency}</span> : null}
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <p className="text-kpi text-text">{value}</p>
        {chart ? <div className="h-8 w-24 shrink-0">{chart}</div> : null}
      </div>
      {delta ? (
        <div className="mt-1.5">
          <StatDelta direction={delta.direction} label={delta.label} />
        </div>
      ) : null}
    </div>
  );
}
