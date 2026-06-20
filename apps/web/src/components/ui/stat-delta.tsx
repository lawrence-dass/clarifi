import type * as React from "react";
import { cn } from "@/lib/utils";

export interface StatDeltaProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Direction of change. `up` = success (green), `down` = danger (red). */
  direction?: "up" | "down" | "flat";
  /** Pre-formatted delta label, e.g. "1.2% than last week". */
  label: string;
}

const arrow: Record<NonNullable<StatDeltaProps["direction"]>, string> = {
  up: "↑",
  down: "↓",
  flat: "→",
};

/**
 * Colored delta indicator (↑/↓ + label) used under KPI values and in table
 * cells. Green for up, red for down. See docs/design-reference.md §5.1.
 */
export function StatDelta({ direction = "up", label, className, ...props }: StatDeltaProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-semibold",
        direction === "up" && "text-success",
        direction === "down" && "text-danger",
        direction === "flat" && "text-text-muted",
        className,
      )}
      {...props}
    >
      <span aria-hidden>{arrow[direction]}</span>
      {label}
    </span>
  );
}
