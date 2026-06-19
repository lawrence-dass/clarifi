import { Worker, type Job } from "bullmq";
import {
  directionFromCents,
  prisma,
  Provider,
  TransactionStatus,
  withUserContext,
  type CanonicalTransaction,
} from "@clarifi/shared";
import { decryptSecret } from "../lib/crypto.js";
import { plaidAdapter, type PlaidAdapter } from "../lib/plaid-adapter.js";
import { requestCategorization } from "../queues/categorize.outbox.js";
import { getRedisConnectionOptions } from "../queues/categorize.queue.js";
import { PLAID_SYNC_QUEUE_NAME, type PlaidSyncJobData } from "../queues/plaid-sync.queue.js";

export interface PlaidSyncOptions {
  adapter?: PlaidAdapter;
  requestCategorizationFn?: typeof requestCategorization;
}

interface PlaidItemForSync {
  id: string;
  userId: string;
  itemId: string;
  accessTokenEncrypted: string;
  cursor: string | null;
}

export async function processPlaidSyncOutboxJob(
  data: PlaidSyncJobData,
  options: PlaidSyncOptions = {},
): Promise<void> {
  try {
    await processPlaidSyncJob(data, options);
    if (data.outboxEventId) {
      await prisma.outbox.update({
        where: { id: data.outboxEventId },
        data: {
          processed: true,
          processedAt: new Date(),
        },
      });
    }
  } catch (err) {
    if (data.outboxEventId) {
      await prisma.outbox.update({
        where: { id: data.outboxEventId },
        data: { attempts: { increment: 1 } },
      });
    }
    throw err;
  }
}

export async function processPlaidSyncJob(
  data: { itemId: string },
  options: PlaidSyncOptions = {},
): Promise<void> {
  const adapter = options.adapter ?? plaidAdapter;
  const requestCategorizationFn = options.requestCategorizationFn ?? requestCategorization;
  const item = await prisma.plaidItem.findUnique({
    where: { itemId: data.itemId },
    select: {
      id: true,
      userId: true,
      itemId: true,
      accessTokenEncrypted: true,
      cursor: true,
    },
  });
  if (!item) return;

  const accessToken = decryptSecret(item.accessTokenEncrypted);
  let cursor = item.cursor ?? undefined;

  while (true) {
    const page = await adapter.syncTransactions(accessToken, cursor);
    await persistPlaidSyncPage(item, page.added, page.modified, page.removedProviderTransactionIds, page.nextCursor);
    cursor = page.nextCursor;
    if (!page.hasMore) break;
  }

  const accountIds = await withUserContext(item.userId, (tx) =>
    tx.account.findMany({
      where: {
        provider: Provider.plaid,
        plaidItemId: item.id,
      },
      select: { id: true },
    }),
  );
  for (const { id: accountId } of accountIds) {
    await requestCategorizationFn({ userId: item.userId, accountId });
  }
}

async function persistPlaidSyncPage(
  item: PlaidItemForSync,
  added: CanonicalTransaction[],
  modified: CanonicalTransaction[],
  removedProviderTransactionIds: string[],
  nextCursor: string,
): Promise<void> {
  return withUserContext(item.userId, async (tx) => {
    const accounts = await tx.account.findMany({
      where: {
        provider: Provider.plaid,
        plaidItemId: item.id,
      },
      select: {
        id: true,
        providerAccountId: true,
      },
    });
    const accountByProviderId = new Map(accounts.map((account) => [account.providerAccountId, account]));
    const accountIds = accounts.map((a) => a.id);

    for (const transaction of [...added, ...modified]) {
      if (!transaction.providerAccountId) continue;
      const account = accountByProviderId.get(transaction.providerAccountId);
      if (!account) continue;

      await tx.transaction.upsert({
        where: {
          accountId_providerTransactionId: {
            accountId: account.id,
            providerTransactionId: transaction.providerTransactionId,
          },
        },
        create: {
          accountId: account.id,
          userId: item.userId,
          provider: Provider.plaid,
          providerTransactionId: transaction.providerTransactionId,
          date: transaction.date,
          amountCents: transaction.amountCents,
          direction: directionFromCents(transaction.amountCents),
          currency: transaction.currency,
          merchantName: transaction.merchantName ?? null,
          rawDescription: transaction.rawDescription,
          status: transaction.pending ? TransactionStatus.pending : TransactionStatus.posted,
          pendingTransactionId: transaction.pendingTransactionId ?? null,
        },
        update: {
          date: transaction.date,
          amountCents: transaction.amountCents,
          direction: directionFromCents(transaction.amountCents),
          currency: transaction.currency,
          merchantName: transaction.merchantName ?? null,
          rawDescription: transaction.rawDescription,
          status: transaction.pending ? TransactionStatus.pending : TransactionStatus.posted,
          pendingTransactionId: transaction.pendingTransactionId ?? null,
        },
      });
    }

    // Supersession: a posted txn arriving with a pendingTransactionId links to the prior
    // pending row — mark that row removed. updateMany is a no-op if the row is absent,
    // keeping this idempotent on replay. Guard !t.pending so a still-pending modified txn
    // with a non-null pendingTransactionId doesn't prematurely remove its predecessor.
    // Guard status: pending so a same-page in-place post (upserted to posted above) is
    // never overwritten to removed by a concurrent supersession entry for the same id.
    const supersededIds = [...added, ...modified]
      .filter((t): t is CanonicalTransaction & { pendingTransactionId: string } =>
        t.pendingTransactionId != null && !t.pending)
      .map((t) => t.pendingTransactionId);

    if (supersededIds.length > 0 && accountIds.length > 0) {
      await tx.transaction.updateMany({
        where: {
          provider: Provider.plaid,
          accountId: { in: accountIds },
          providerTransactionId: { in: supersededIds },
          status: TransactionStatus.pending,
        },
        data: { status: TransactionStatus.removed },
      });
    }

    // Explicit removals: mark rows removed (kept, never hard-deleted).
    if (removedProviderTransactionIds.length > 0 && accountIds.length > 0) {
      await tx.transaction.updateMany({
        where: {
          provider: Provider.plaid,
          accountId: { in: accountIds },
          providerTransactionId: { in: removedProviderTransactionIds },
        },
        data: { status: TransactionStatus.removed },
      });
    }

    await tx.plaidItem.update({
      where: { id: item.id },
      data: { cursor: nextCursor },
    });
  });
}

export function createPlaidSyncWorker(): Worker<PlaidSyncJobData> {
  return new Worker<PlaidSyncJobData>(
    PLAID_SYNC_QUEUE_NAME,
    async (job: Job<PlaidSyncJobData>) => {
      await processPlaidSyncOutboxJob(job.data);
    },
    { connection: getRedisConnectionOptions() },
  );
}
