import { withUserContext } from "@clarifi/shared";
import { toFDXAccount, toFDXCustomer, toFDXTransaction } from "./fdx.adapter.js";
import type { FDXAccount, FDXCustomer, FDXTransaction } from "./fdx.adapter.js";

const DEFAULT_TX_LIMIT = 50;
const MAX_TX_LIMIT = 200;

export async function listFDXAccounts(userId: string): Promise<FDXAccount[]> {
  const rows = await withUserContext(userId, (tx) =>
    tx.account.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        institutionName: true,
        accountType: true,
        balanceCents: true,
        currency: true,
      },
    }),
  );
  return rows.map(toFDXAccount);
}

export async function listFDXTransactions(params: {
  userId: string;
  accountId: string;
  limit?: number;
  cursor?: string; // ISO date string — return rows after (newer than) this date
}): Promise<{ transactions: FDXTransaction[]; nextCursor: string | null }> {
  const limit = Math.min(params.limit ?? DEFAULT_TX_LIMIT, MAX_TX_LIMIT);

  const rows = await withUserContext(params.userId, (tx) =>
    tx.transaction.findMany({
      where: {
        userId: params.userId,
        accountId: params.accountId,
        status: { not: "removed" },
        ...(params.cursor ? { date: { lt: new Date(params.cursor) } } : {}),
      },
      orderBy: { date: "desc" },
      take: limit + 1,
      select: {
        id: true,
        accountId: true,
        date: true,
        amountCents: true,
        direction: true,
        currency: true,
        rawDescription: true,
        merchantName: true,
        category: true,
        status: true,
      },
    }),
  );

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1]!.date.toISOString() : null;

  return { transactions: page.map(toFDXTransaction), nextCursor };
}

export async function getFDXCustomer(userId: string): Promise<FDXCustomer | null> {
  const row = await withUserContext(userId, (tx) =>
    tx.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    }),
  );
  return row ? toFDXCustomer(row) : null;
}
