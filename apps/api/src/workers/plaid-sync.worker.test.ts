import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  AccountType,
  prisma,
  Provider,
  TransactionDirection,
  TransactionStatus,
  withUserContext,
  type CanonicalTransaction,
} from "@clarifi/shared";
import { encryptSecret } from "../lib/crypto.js";
import { PLAID_SYNC_REQUESTED_EVENT } from "../queues/plaid-sync.outbox.js";
import {
  processPlaidSyncJob,
  processPlaidSyncOutboxJob,
  type PlaidSyncOptions,
} from "./plaid-sync.worker.js";
import type { PlaidAdapter } from "../lib/plaid-adapter.js";

const dbUrl = process.env.DATABASE_URL ?? "";
const hasDb = dbUrl.length > 0 && !dbUrl.includes("placeholder");
const userIds: string[] = [];

function canonical(input: {
  providerTransactionId: string;
  providerAccountId: string;
  amountCents: bigint;
  rawDescription?: string;
  pending?: boolean;
  pendingTransactionId?: string | null;
}): CanonicalTransaction {
  return {
    providerTransactionId: input.providerTransactionId,
    providerAccountId: input.providerAccountId,
    date: new Date("2026-06-01T00:00:00.000Z"),
    amountCents: input.amountCents,
    currency: "CAD",
    rawDescription: input.rawDescription ?? `PLAID TEST ${input.providerTransactionId}`,
    merchantName: "Plaid Merchant",
    pending: input.pending ?? false,
    pendingTransactionId: input.pendingTransactionId ?? null,
  };
}

async function seedLinkedItem(input?: { cursor?: string | null }) {
  const user = await prisma.user.create({
    data: {
      email: `plaid-sync-${randomUUID()}@example.test`,
      passwordHash: "hashed-password",
      consentedAt: new Date("2026-06-01T00:00:00.000Z"),
    },
  });
  userIds.push(user.id);
  const itemId = `item-${randomUUID()}`;
  const plaidItem = await prisma.plaidItem.create({
    data: {
      userId: user.id,
      itemId,
      institutionName: "Worker Test Bank",
      accessTokenEncrypted: encryptSecret("access-worker-secret"),
      cursor: input?.cursor ?? null,
    },
  });
  const checkingProviderAccountId = `checking-${randomUUID()}`;
  const cardProviderAccountId = `card-${randomUUID()}`;
  const checking = await prisma.account.create({
    data: {
      userId: user.id,
      provider: Provider.plaid,
      providerAccountId: checkingProviderAccountId,
      institutionName: "Worker Test Bank",
      accountType: AccountType.checking,
      balanceCents: 0n,
      currency: "CAD",
      plaidItemId: plaidItem.id,
    },
  });
  const card = await prisma.account.create({
    data: {
      userId: user.id,
      provider: Provider.plaid,
      providerAccountId: cardProviderAccountId,
      institutionName: "Worker Test Bank",
      accountType: AccountType.credit_card,
      balanceCents: 0n,
      currency: "CAD",
      plaidItemId: plaidItem.id,
    },
  });
  return { user, itemId, plaidItem, checking, card, checkingProviderAccountId, cardProviderAccountId };
}

function fakeOptions(
  syncTransactions: PlaidAdapter["syncTransactions"],
  requestCategorizationFn = vi.fn(async () => undefined),
): PlaidSyncOptions & { requestCategorizationFn: typeof requestCategorizationFn } {
  return {
    adapter: {
      async createLinkToken() {
        throw new Error("not used");
      },
      async exchangePublicToken() {
        throw new Error("not used");
      },
      async getItemAccounts() {
        throw new Error("not used");
      },
      async getWebhookVerificationKey() {
        throw new Error("not used");
      },
      syncTransactions,
    },
    requestCategorizationFn,
  };
}

afterEach(async () => {
  if (hasDb) await prisma.outbox.deleteMany({ where: { eventType: PLAID_SYNC_REQUESTED_EVENT } });
});

afterAll(async () => {
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe.skipIf(!hasDb)("processPlaidSyncJob", () => {
  it("upserts added and modified transactions idempotently and enqueues categorization", async () => {
    const seeded = await seedLinkedItem();
    const requestCategorizationFn = vi.fn(async () => undefined);
    const options = fakeOptions(
      vi.fn(async () => ({
        added: [
          canonical({
            providerTransactionId: "txn-added",
            providerAccountId: seeded.checkingProviderAccountId,
            amountCents: -1234n,
          }),
        ],
        modified: [
          canonical({
            providerTransactionId: "txn-modified",
            providerAccountId: seeded.cardProviderAccountId,
            amountCents: 2500n,
            pending: true,
            pendingTransactionId: "pending-1",
          }),
        ],
        removedProviderTransactionIds: [],
        nextCursor: "cursor-final",
        hasMore: false,
      })),
      requestCategorizationFn,
    );

    await processPlaidSyncJob({ itemId: seeded.itemId }, options);
    await prisma.plaidItem.update({ where: { id: seeded.plaidItem.id }, data: { cursor: null } });
    await processPlaidSyncJob({ itemId: seeded.itemId }, options);

    const rows = await withUserContext(seeded.user.id, (tx) =>
      tx.transaction.findMany({ orderBy: { providerTransactionId: "asc" } }),
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.providerTransactionId === "txn-added")).toMatchObject({
      amountCents: -1234n,
      direction: TransactionDirection.debit,
      status: TransactionStatus.posted,
    });
    expect(rows.find((row) => row.providerTransactionId === "txn-modified")).toMatchObject({
      amountCents: 2500n,
      direction: TransactionDirection.credit,
      status: TransactionStatus.pending,
      pendingTransactionId: "pending-1",
    });
    expect(await prisma.plaidItem.findUnique({ where: { id: seeded.plaidItem.id }, select: { cursor: true } })).toEqual({
      cursor: "cursor-final",
    });
    expect(requestCategorizationFn).toHaveBeenCalledWith({ userId: seeded.user.id, accountId: seeded.checking.id });
    expect(requestCategorizationFn).toHaveBeenCalledWith({ userId: seeded.user.id, accountId: seeded.card.id });
  }, 20_000);

  it("persists each successful page cursor and retries safely after a later page failure", async () => {
    const seeded = await seedLinkedItem();
    const outbox = await prisma.outbox.create({
      data: {
        eventType: PLAID_SYNC_REQUESTED_EVENT,
        payload: { itemId: seeded.itemId, webhookCode: "SYNC_UPDATES_AVAILABLE" },
      },
    });
    const firstRunSync = vi.fn(async (_accessToken: string, cursor?: string) => {
      if (!cursor) {
        return {
          added: [
            canonical({
              providerTransactionId: "txn-first-page",
              providerAccountId: seeded.checkingProviderAccountId,
              amountCents: -500n,
            }),
          ],
          modified: [],
          removedProviderTransactionIds: [],
          nextCursor: "cursor-page-1",
          hasMore: true,
        };
      }
      throw new Error("Plaid unavailable after page 1");
    });

    await expect(
      processPlaidSyncOutboxJob(
        { itemId: seeded.itemId, outboxEventId: outbox.id },
        fakeOptions(firstRunSync),
      ),
    ).rejects.toThrow("Plaid unavailable");

    const afterFailure = await prisma.outbox.findUniqueOrThrow({ where: { id: outbox.id } });
    expect(afterFailure.processed).toBe(false);
    expect(afterFailure.attempts).toBe(1);
    expect(await prisma.plaidItem.findUnique({ where: { id: seeded.plaidItem.id }, select: { cursor: true } })).toEqual({
      cursor: "cursor-page-1",
    });

    const retrySync = vi.fn(async (_accessToken: string, cursor?: string) => {
      expect(cursor).toBe("cursor-page-1");
      return {
        added: [
          canonical({
            providerTransactionId: "txn-second-page",
            providerAccountId: seeded.checkingProviderAccountId,
            amountCents: -900n,
          }),
        ],
        modified: [],
        removedProviderTransactionIds: [],
        nextCursor: "cursor-final",
        hasMore: false,
      };
    });
    await processPlaidSyncOutboxJob(
      { itemId: seeded.itemId, outboxEventId: outbox.id },
      fakeOptions(retrySync),
    );

    const afterRetry = await prisma.outbox.findUniqueOrThrow({ where: { id: outbox.id } });
    expect(afterRetry.processed).toBe(true);
    const rows = await withUserContext(seeded.user.id, (tx) => tx.transaction.findMany());
    expect(rows.map((row) => row.providerTransactionId).sort()).toEqual(["txn-first-page", "txn-second-page"]);
  }, 20_000);

  it("skips transactions for unknown Plaid accounts without fabricating accounts", async () => {
    const seeded = await seedLinkedItem();
    const options = fakeOptions(
      vi.fn(async () => ({
        added: [
          canonical({
            providerTransactionId: "txn-unknown-account",
            providerAccountId: "unknown-account",
            amountCents: -100n,
          }),
        ],
        modified: [],
        removedProviderTransactionIds: [],
        nextCursor: "cursor-final",
        hasMore: false,
      })),
    );

    await processPlaidSyncJob({ itemId: seeded.itemId }, options);

    expect(await withUserContext(seeded.user.id, (tx) => tx.transaction.count())).toBe(0);
    expect(await withUserContext(seeded.user.id, (tx) => tx.account.count())).toBe(2);
  }, 20_000);
});
