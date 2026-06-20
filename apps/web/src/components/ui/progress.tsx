import type * as React from "react";
import { cn } from "@/lib/utils";

const toneClass = {
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
} as const;

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 0–100. Clamped. Values >100 still render a full bar (use `danger` tone). */
  value: number;
  tone?: keyof typeof toneClass;
  /** Show the "%" label at the right, per the reference. */
  showValue?: boolean;
}

/**
 * Thin progress bar with optional right-aligned % label. Used for budget
 * progress — pair with budget-tone logic (success → warning at 80% → danger
 * at 100%). See docs/design-reference.md §5.7.
 */
export function Progress({
  value,
  tone = "primary",
  showValue = false,
  className,
  ...props
}: ProgressProps) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("flex items-center gap-3", className)} {...props}>
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn("h-full rounded-full transition-all", toneClass[tone])}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showValue ? (
        <span className="w-9 shrink-0 text-right text-xs font-medium text-text-muted tabular-nums">
          {Math.round(value)}%
        </span>
      ) : null}
    </div>
  );
}
