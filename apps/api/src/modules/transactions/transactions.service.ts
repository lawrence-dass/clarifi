import {
  Category,
  TransactionDirection,
  TransactionStatus,
  withUserContext,
} from "@clarifi/shared";

export interface CategoryBreakdownCategory {
  category: Category;
  totalCents: number;
  transactionCount: number;
}

export interface CategoryBreakdownCurrency {
  currency: string;
  totalCents: number;
  categories: CategoryBreakdownCategory[];
}

export interface CategoryBreakdownResult {
  month: string;
  currencies: CategoryBreakdownCurrency[];
}

export interface SpendingTrendTotal {
  month: string;
  totalCents: number;
}

export interface SpendingTrendCurrency {
  currency: string;
  totals: SpendingTrendTotal[];
}

export interface SpendingTrendResult {
  months: string[];
  currencies: SpendingTrendCurrency[];
}

interface CategoryBreakdownCurrencyAccumulator {
  currency: string;
  totalCents: bigint;
  categories: CategoryBreakdownCategory[];
}

interface SpendingTrendCurrencyAccumulator {
  currency: string;
  totalsByMonth: Map<string, bigint>;
}

interface CurrencyBucket {
  currency: string;
}

export async function categoryBreakdown(input: {
  userId: string;
  month: string;
}): Promise<CategoryBreakdownResult> {
  const { monthStart, nextMonthStart } = monthRangeUtc(input.month);

  const rows = await withUserContext(input.userId, (tx) =>
    tx.transaction.groupBy({
      by: ["currency", "category"],
      where: {
        date: {
          gte: monthStart,
          lt: nextMonthStart,
        },
        direction: TransactionDirection.debit,
        amountCents: {
          lt: 0,
        },
        status: {
          not: TransactionStatus.removed,
        },
        category: {
          not: null,
        },
      },
      _sum: {
        amountCents: true,
      },
      _count: {
        _all: true,
      },
    }),
  );

  const buckets = new Map<string, CategoryBreakdownCurrencyAccumulator>();
  for (const row of rows) {
    if (!row.category) continue;
    const totalCents = positiveCents(row._sum.amountCents ?? 0n);
    const bucket = buckets.get(row.currency) ?? {
      currency: row.currency,
      totalCents: 0n,
      categories: [],
    };
    bucket.categories.push({
      category: row.category,
      totalCents: toSafeIntegerCents(totalCents),
      transactionCount: row._count._all,
    });
    bucket.totalCents += totalCents;
    buckets.set(row.currency, bucket);
  }

  const currencies = Array.from(buckets.values())
    .map((bucket) => ({
      currency: bucket.currency,
      totalCents: toSafeIntegerCents(bucket.totalCents),
      categories: bucket.categories.sort((a, b) => b.totalCents - a.totalCents),
    }))
    .sort(compareCurrencyBuckets);

  return { month: input.month, currencies };
}

export async function spendingTrend(input: {
  userId: string;
  endMonth: string;
}): Promise<SpendingTrendResult> {
  const months = enumerateMonths(input.endMonth, 6);

  const monthlyRows = await withUserContext(input.userId, async (tx) => {
    const results = [];
    for (const month of months) {
      const { monthStart, nextMonthStart } = monthRangeUtc(month);
      const rows = await tx.transaction.groupBy({
        by: ["currency"],
        where: {
          date: {
            gte: monthStart,
            lt: nextMonthStart,
          },
          direction: TransactionDirection.debit,
          amountCents: {
            lt: 0,
          },
          status: {
            not: TransactionStatus.removed,
          },
        },
        _sum: {
          amountCents: true,
        },
      });

      results.push({ month, rows });
    }
    return results;
  });

  const buckets = new Map<string, SpendingTrendCurrencyAccumulator>();
  for (const { month, rows } of monthlyRows) {
    for (const row of rows) {
      const bucket = buckets.get(row.currency) ?? {
        currency: row.currency,
        totalsByMonth: new Map<string, bigint>(),
      };
      bucket.totalsByMonth.set(month, positiveCents(row._sum.amountCents ?? 0n));
      buckets.set(row.currency, bucket);
    }
  }

  const currencies = Array.from(buckets.values())
    .map((bucket) => ({
      currency: bucket.currency,
      totals: months.map((month) => ({
        month,
        totalCents: toSafeIntegerCents(bucket.totalsByMonth.get(month) ?? 0n),
      })),
    }))
    .sort(compareCurrencyBuckets);

  return { months, currencies };
}

export function monthRangeUtc(month: string): { monthStart: Date; nextMonthStart: Date } {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  return {
    monthStart: new Date(Date.UTC(year, monthNumber - 1, 1)),
    nextMonthStart: new Date(Date.UTC(year, monthNumber, 1)),
  };
}

export function enumerateMonths(endMonth: string, count: number): string[] {
  const year = Number(endMonth.slice(0, 4));
  const monthNumber = Number(endMonth.slice(5, 7));
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, monthNumber - count + index, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

function positiveCents(value: bigint): bigint {
  return value < 0n ? -value : value;
}

export function toSafeIntegerCents(value: bigint): number {
  const magnitude = positiveCents(value);
  const asNumber = Number(magnitude);
  if (!Number.isSafeInteger(asNumber)) {
    throw new Error("Transaction analytics amount exceeds JSON-safe integer cents");
  }
  return asNumber;
}

function compareCurrencyBuckets(a: CurrencyBucket, b: CurrencyBucket): number {
  if (a.currency === b.currency) return 0;
  if (a.currency === "CAD") return -1;
  if (b.currency === "CAD") return 1;
  return a.currency.localeCompare(b.currency);
}
