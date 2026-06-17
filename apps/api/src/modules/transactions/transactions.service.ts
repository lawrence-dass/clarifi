import {
  Category,
  Prisma,
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

export interface TopMerchant {
  merchantName: string;
  totalCents: number;
  transactionCount: number;
}

export interface CategoryDelta {
  category: Category;
  currentCents: number;
  previousCents: number;
  deltaCents: number;
}

export interface CashFlowSummaryCurrency {
  currency: string;
  incomeCents: number;
  expensesCents: number;
  netCents: number;
  topMerchants: TopMerchant[];
  categoryDeltas: CategoryDelta[];
}

export interface CashFlowSummaryResult {
  month: string;
  previousMonth: string;
  currencies: CashFlowSummaryCurrency[];
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

export interface CategorySpendRow {
  currency: string;
  category: Category;
  totalCents: bigint;
  transactionCount: number;
}

interface CashFlowAccumulator {
  currency: string;
  incomeCents: bigint;
  expensesCents: bigint;
  topMerchants: TopMerchant[];
  currentCategories: Map<Category, bigint>;
  previousCategories: Map<Category, bigint>;
}

const TOP_MERCHANT_LIMIT = 5;

export async function categoryBreakdown(input: {
  userId: string;
  month: string;
}): Promise<CategoryBreakdownResult> {
  const range = monthRangeUtc(input.month);
  const rows = await withUserContext(input.userId, (tx) =>
    aggregateCategorySpendByCurrency(tx, range),
  );

  const buckets = new Map<string, CategoryBreakdownCurrencyAccumulator>();
  for (const row of rows) {
    const bucket = buckets.get(row.currency) ?? {
      currency: row.currency,
      totalCents: 0n,
      categories: [],
    };
    bucket.categories.push({
      category: row.category,
      totalCents: toSafeIntegerCents(row.totalCents),
      transactionCount: row.transactionCount,
    });
    bucket.totalCents += row.totalCents;
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

export async function cashFlowSummary(input: {
  userId: string;
  month: string;
}): Promise<CashFlowSummaryResult> {
  const previousMonth = enumerateMonths(input.month, 2)[0] ?? input.month;
  const currentRange = monthRangeUtc(input.month);
  const previousRange = monthRangeUtc(previousMonth);

  const { cashRows, merchantRows, currentCategoryRows, previousCategoryRows } =
    await withUserContext(input.userId, async (tx) => {
      const cashRows = await tx.transaction.groupBy({
        by: ["currency", "direction"],
        where: {
          date: {
            gte: currentRange.monthStart,
            lt: currentRange.nextMonthStart,
          },
          status: {
            not: TransactionStatus.removed,
          },
          OR: [
            {
              direction: TransactionDirection.credit,
              amountCents: {
                gt: 0,
              },
            },
            {
              direction: TransactionDirection.debit,
              amountCents: {
                lt: 0,
              },
            },
          ],
        },
        _sum: {
          amountCents: true,
        },
      });

      const merchantRows = await tx.transaction.groupBy({
        by: ["currency", "merchantName"],
        where: {
          date: {
            gte: currentRange.monthStart,
            lt: currentRange.nextMonthStart,
          },
          direction: TransactionDirection.debit,
          amountCents: {
            lt: 0,
          },
          status: {
            not: TransactionStatus.removed,
          },
          merchantName: {
            not: null,
          },
        },
        _sum: {
          amountCents: true,
        },
        _count: {
          _all: true,
        },
      });

      const currentCategoryRows = await aggregateCategorySpendByCurrency(tx, currentRange);
      const previousCategoryRows = await aggregateCategorySpendByCurrency(tx, previousRange);

      return { cashRows, merchantRows, currentCategoryRows, previousCategoryRows };
    });

  const buckets = new Map<string, CashFlowAccumulator>();
  const bucketFor = (currency: string): CashFlowAccumulator => {
    const existing = buckets.get(currency);
    if (existing) return existing;
    const created: CashFlowAccumulator = {
      currency,
      incomeCents: 0n,
      expensesCents: 0n,
      topMerchants: [],
      currentCategories: new Map<Category, bigint>(),
      previousCategories: new Map<Category, bigint>(),
    };
    buckets.set(currency, created);
    return created;
  };

  for (const row of cashRows) {
    const bucket = bucketFor(row.currency);
    const totalCents = positiveCents(row._sum.amountCents ?? 0n);
    if (row.direction === TransactionDirection.credit) {
      bucket.incomeCents += totalCents;
    } else if (row.direction === TransactionDirection.debit) {
      bucket.expensesCents += totalCents;
    }
  }

  const merchantsByCurrency = new Map<string, TopMerchant[]>();
  for (const row of merchantRows) {
    if (!row.merchantName) continue;
    const merchant = {
      merchantName: row.merchantName,
      totalCents: toSafeIntegerCents(row._sum.amountCents ?? 0n),
      transactionCount: row._count._all,
    };
    const merchants = merchantsByCurrency.get(row.currency) ?? [];
    merchants.push(merchant);
    merchantsByCurrency.set(row.currency, merchants);
    bucketFor(row.currency);
  }

  for (const [currency, merchants] of merchantsByCurrency) {
    bucketFor(currency).topMerchants = merchants
      .sort((a, b) => b.totalCents - a.totalCents || a.merchantName.localeCompare(b.merchantName))
      .slice(0, TOP_MERCHANT_LIMIT);
  }

  for (const row of currentCategoryRows) {
    bucketFor(row.currency).currentCategories.set(row.category, row.totalCents);
  }

  for (const row of previousCategoryRows) {
    bucketFor(row.currency).previousCategories.set(row.category, row.totalCents);
  }

  const currencies = Array.from(buckets.values())
    .map((bucket) => {
      const incomeCents = toSafeIntegerCents(bucket.incomeCents);
      const expensesCents = toSafeIntegerCents(bucket.expensesCents);
      return {
        currency: bucket.currency,
        incomeCents,
        expensesCents,
        netCents: incomeCents - expensesCents,
        topMerchants: bucket.topMerchants,
        categoryDeltas: categoryDeltasFor(bucket),
      };
    })
    .sort(compareCurrencyBuckets);

  return { month: input.month, previousMonth, currencies };
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

export async function aggregateCategorySpendByCurrency(
  tx: Prisma.TransactionClient,
  range: { monthStart: Date; nextMonthStart: Date },
): Promise<CategorySpendRow[]> {
  const rows = await tx.transaction.groupBy({
    by: ["currency", "category"],
    where: {
      date: {
        gte: range.monthStart,
        lt: range.nextMonthStart,
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
  });

  return rows.flatMap((row) => {
    if (!row.category) return [];
    return [
      {
        currency: row.currency,
        category: row.category,
        totalCents: positiveCents(row._sum.amountCents ?? 0n),
        transactionCount: row._count._all,
      },
    ];
  });
}

function categoryDeltasFor(bucket: CashFlowAccumulator): CategoryDelta[] {
  const categories = new Set<Category>([
    ...bucket.currentCategories.keys(),
    ...bucket.previousCategories.keys(),
  ]);

  return Array.from(categories)
    .map((category) => {
      const currentCents = toSafeIntegerCents(bucket.currentCategories.get(category) ?? 0n);
      const previousCents = toSafeIntegerCents(bucket.previousCategories.get(category) ?? 0n);
      return {
        category,
        currentCents,
        previousCents,
        deltaCents: currentCents - previousCents,
      };
    })
    .sort((a, b) =>
      b.currentCents - a.currentCents ||
      b.previousCents - a.previousCents ||
      a.category.localeCompare(b.category),
    );
}
