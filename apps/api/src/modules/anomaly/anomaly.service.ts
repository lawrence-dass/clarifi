import {
  AnomalySeverity,
  AnomalyType,
  withUserContext,
} from "@clarifi/shared";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export interface AnomalyTransaction {
  id: string;
  amountCents: number;
  merchantName: string | null;
  category: string | null;
  date: string; // ISO date string
  currency: string;
}

export interface AnomalyItem {
  id: string;
  type: AnomalyType;
  severity: AnomalySeverity;
  explanation: string | null;
  dismissed: boolean;
  reportedSuspicious: boolean;
  createdAt: string; // ISO datetime for cursor
  transaction: AnomalyTransaction;
}

export interface ListAnomaliesResult {
  anomalies: AnomalyItem[];
  nextCursor: string | null;
}

export async function listAnomalies(params: {
  userId: string;
  includeDismissed?: boolean;
  severity?: AnomalySeverity;
  limit?: number;
  cursor?: string; // createdAt ISO string — return rows before this timestamp
}): Promise<ListAnomaliesResult> {
  const limit = Math.min(params.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const includeDismissed = params.includeDismissed ?? false;

  const rows = await withUserContext(params.userId, (tx) =>
    tx.anomaly.findMany({
      where: {
        userId: params.userId,
        ...(includeDismissed ? {} : { dismissed: false }),
        ...(params.severity ? { severity: params.severity } : {}),
        ...(params.cursor ? { createdAt: { lt: new Date(params.cursor) } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1, // fetch one extra to determine if there's a next page
      select: {
        id: true,
        type: true,
        severity: true,
        explanation: true,
        dismissed: true,
        reportedSuspicious: true,
        createdAt: true,
        transaction: {
          select: {
            id: true,
            amountCents: true,
            merchantName: true,
            category: true,
            date: true,
            currency: true,
          },
        },
      },
    }),
  );

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const anomalies: AnomalyItem[] = page.map((row) => ({
    id: row.id,
    type: row.type,
    severity: row.severity,
    explanation: row.explanation,
    dismissed: row.dismissed,
    reportedSuspicious: row.reportedSuspicious,
    createdAt: row.createdAt.toISOString(),
    transaction: {
      id: row.transaction.id,
      amountCents: Number(row.transaction.amountCents),
      merchantName: row.transaction.merchantName,
      category: row.transaction.category,
      date: row.transaction.date.toISOString(),
      currency: row.transaction.currency,
    },
  }));

  const nextCursor = hasMore ? page[page.length - 1]!.createdAt.toISOString() : null;

  return { anomalies, nextCursor };
}

export async function dismissAnomaly(params: {
  userId: string;
  anomalyId: string;
}): Promise<void> {
  await withUserContext(params.userId, (tx) =>
    tx.anomaly.updateMany({
      where: { id: params.anomalyId, userId: params.userId },
      data: { dismissed: true },
    }),
  );
}

export async function reportAnomaly(params: {
  userId: string;
  anomalyId: string;
}): Promise<void> {
  await withUserContext(params.userId, (tx) =>
    tx.anomaly.updateMany({
      where: { id: params.anomalyId, userId: params.userId },
      data: { reportedSuspicious: true, dismissed: false },
    }),
  );
}
