import type * as React from "react";
import { cn } from "@/lib/utils";

/** Ordered categorical palette (Tailwind bg classes) — see design-reference §2. */
export const CATEGORY_BG = [
  "bg-cat-blue",
  "bg-cat-teal",
  "bg-cat-green",
  "bg-cat-amber",
  "bg-cat-pink",
  "bg-cat-purple",
] as const;

export interface Segment {
  label: string;
  value: number;
  /** Tailwind bg class, e.g. "bg-cat-blue". Defaults by index from CATEGORY_BG. */
  colorClass?: string;
}

export interface SegmentedBarProps extends React.HTMLAttributes<HTMLDivElement> {
  segments: Segment[];
  /** Render the legend table (dot • label • value • %) below the bar. */
  legend?: boolean;
  /** Pre-format a segment value for the legend (e.g. money). */
  formatValue?: (value: number) => string;
}

/**
 * Stacked multi-color bar + optional legend — the spending-by-category pattern
 * from the reference's performance-score widget. See docs/design-reference §5.6.
 */
export function SegmentedBar({
  segments,
  legend = false,
  formatValue,
  className,
  ...props
}: SegmentedBarProps) {
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  const colorFor = (s: Segment, i: number) => s.colorClass ?? CATEGORY_BG[i % CATEGORY_BG.length];

  return (
    <div className={cn("space-y-3", className)} {...props}>
      <div className="flex h-2 overflow-hidden rounded-full bg-border">
        {segments.map((s, i) => (
          <div
            key={s.label}
            className={cn(colorFor(s, i))}
            style={{ width: `${(s.value / total) * 100}%` }}
            title={s.label}
          />
        ))}
      </div>
      {legend ? (
        <ul className="space-y-1.5">
          {segments.map((s, i) => (
            <li key={s.label} className="flex items-center gap-2 text-sm">
              <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", colorFor(s, i))} />
              <span className="flex-1 truncate text-text">{s.label}</span>
              <span className="text-text-muted tabular-nums">
                {formatValue ? formatValue(s.value) : s.value}
              </span>
              <span className="w-10 text-right text-text-faint tabular-nums">
                {Math.round((s.value / total) * 100)}%
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
