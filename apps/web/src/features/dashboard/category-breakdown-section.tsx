"use client";

import { SegmentedBar } from "@/components/ui/segmented-bar";
import { formatMoney } from "@/lib/format-money";
import { categoryBreakdownBucket } from "./dashboard-utils";
import { useCategoryBreakdown } from "./hooks";
import { SectionFrame } from "./section-frame";
import { categoryLabel } from "./types";

export function CategoryBreakdownSection({ month, currency }: { month: string; currency: string }) {
  const query = useCategoryBreakdown(month);
  const bucket = categoryBreakdownBucket(query.data, currency);
  const categories = bucket?.categories ?? [];
  const segments = categories.map((cat) => ({
    label: categoryLabel(cat.category),
    value: Math.abs(cat.totalCents),
  }));

  return (
    <SectionFrame
      title="Category breakdown"
      isPending={query.isPending}
      error={query.error}
      isEmpty={!segments.length}
      emptyMessage={`No ${currency} category spending for ${month}.`}
    >
      <div
        aria-label={`Category breakdown for ${currency} in ${month}`}
      >
        <SegmentedBar
          segments={segments}
          legend
          formatValue={(v) => formatMoney(v, currency)}
        />
      </div>
    </SectionFrame>
  );
}
