import { withUserContext } from "@clarifi/shared";

export interface DigestData {
  userId: string;
  email: string;
  weekStart: string; // YYYY-MM-DD
  weekEnd: string; // YYYY-MM-DD
  totalSpendCents: bigint;
  currency: string;
  topCategories: Array<{ category: string; totalCents: bigint }>;
  criticalAnomalyCount: number;
  overBudgetCategories: Array<{ category: string; percentUsed: number }>;
}

/** Last Monday → last Sunday (ISO week, inclusive). */
export function lastWeekRange(today: Date): { start: Date; end: Date } {
  const d = new Date(today);
  // Sunday = 0, Monday = 1 … Saturday = 6
  const dayOfWeek = d.getDay(); // 0=Sun
  // Days since last Monday: if today is Mon=1 → 7, Sun=0 → 6, Sat=6 → 1
  const daysSinceLastMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1 + 7;
  const lastMonday = new Date(d);
  lastMonday.setDate(d.getDate() - daysSinceLastMonday);
  lastMonday.setHours(0, 0, 0, 0);
  const lastSunday = new Date(lastMonday);
  lastSunday.setDate(lastMonday.getDate() + 6);
  lastSunday.setHours(23, 59, 59, 999);
  return { start: lastMonday, end: lastSunday };
}

export async function buildDigestData(
  userId: string,
  userEmail: string,
  weekStart: Date,
  weekEnd: Date,
): Promise<DigestData> {
  const start = weekStart.toISOString().slice(0, 10);
  const end = weekEnd.toISOString().slice(0, 10);

  return withUserContext(userId, async (tx) => {
    // Aggregate total spend for the week (outflows, amount_cents < 0)
    const spendAgg = await tx.transaction.aggregate({
      where: {
        userId,
        date: { gte: weekStart, lte: weekEnd },
        amountCents: { lt: 0 },
        status: { not: "removed" },
      },
      _sum: { amountCents: true },
    });

    // Top 3 spending categories by absolute spend
    const catRows = await tx.transaction.groupBy({
      by: ["category"],
      where: {
        userId,
        date: { gte: weekStart, lte: weekEnd },
        amountCents: { lt: 0 },
        status: { not: "removed" },
        category: { not: null },
      },
      _sum: { amountCents: true },
      orderBy: { _sum: { amountCents: "asc" } }, // most negative = most spent
      take: 3,
    });

    // Critical anomalies in the week
    const criticalCount = await tx.anomaly.count({
      where: {
        userId,
        severity: "critical",
        dismissed: false,
        createdAt: { gte: weekStart, lte: weekEnd },
      },
    });

    // Budgets at/over 80% for current month
    const monthStr = weekEnd.toISOString().slice(0, 7); // YYYY-MM
    const budgets = await tx.budget.findMany({
      where: { userId, month: monthStr },
      select: { category: true, monthlyLimitCents: true },
    });

    const overBudgetCategories: Array<{ category: string; percentUsed: number }> = [];
    for (const budget of budgets) {
      const spent = await tx.transaction.aggregate({
        where: {
          userId,
          category: budget.category,
          date: { gte: new Date(`${monthStr}-01`), lt: new Date(`${nextMonth(monthStr)}-01`) },
          amountCents: { lt: 0 },
          status: { not: "removed" },
        },
        _sum: { amountCents: true },
      });
      const spentCents = BigInt(spent._sum.amountCents ?? 0n);
      const limitCents = budget.monthlyLimitCents;
      const pct = limitCents > 0n ? Math.round((Number(-spentCents) / Number(limitCents)) * 100) : 0;
      if (pct >= 80) {
        overBudgetCategories.push({ category: budget.category ?? "other", percentUsed: pct });
      }
    }

    // Determine dominant currency (just use CAD as default; no cross-currency sums)
    return {
      userId,
      email: userEmail,
      weekStart: start,
      weekEnd: end,
      totalSpendCents: spendAgg._sum.amountCents ?? 0n,
      currency: "CAD",
      topCategories: catRows.map((r) => ({
        category: r.category ?? "other",
        totalCents: r._sum.amountCents ?? 0n,
      })),
      criticalAnomalyCount: criticalCount,
      overBudgetCategories,
    };
  });
}

function nextMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
