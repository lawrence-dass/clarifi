import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  AccountType,
  Category,
  prisma,
  Provider,
  TransactionDirection,
  TransactionStatus,
  withUserContext,
  type CanonicalTransaction,
} from "@clarifi/shared";
import { encryptSecret } from "../lib/crypto.js";
import { PLAID_SYNC_REQUESTED_EVENT } from "../queues/plaid-sync.outbox.js";
import { categoryBreakdown } from "../modules/transactions/transactions.service.js";
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

  it("in-place post: pending row transitions to posted when the same id arrives as not pending", async () => {
    const seeded = await seedLinkedItem();

    // First sync: add as pending
    await processPlaidSyncJob(
      { itemId: seeded.itemId },
      fakeOptions(vi.fn(async () => ({
        added: [canonical({ providerTransactionId: "txn-lifecycle", providerAccountId: seeded.checkingProviderAccountId, amountCents: -1500n, pending: true })],
        modified: [],
        removedProviderTransactionIds: [],
        nextCursor: "cursor-1",
        hasMore: false,
      }))),
    );

    // Second sync: same id arrives posted
    await processPlaidSyncJob(
      { itemId: seeded.itemId },
      fakeOptions(vi.fn(async () => ({
        added: [],
        modified: [canonical({ providerTransactionId: "txn-lifecycle", providerAccountId: seeded.checkingProviderAccountId, amountCents: -1500n, pending: false })],
        removedProviderTransactionIds: [],
        nextCursor: "cursor-2",
        hasMore: false,
      }))),
    );

    const rows = await withUserContext(seeded.user.id, (tx) => tx.transaction.findMany());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ providerTransactionId: "txn-lifecycle", status: TransactionStatus.posted, amountCents: -1500n });
  }, 40_000);

  it("supersession: new posted transaction marks prior pending row removed and links via pendingTransactionId", async () => {
    const seeded = await seedLinkedItem();

    // Seed the pending row
    await processPlaidSyncJob(
      { itemId: seeded.itemId },
      fakeOptions(vi.fn(async () => ({
        added: [canonical({ providerTransactionId: "txn-pending", providerAccountId: seeded.checkingProviderAccountId, amountCents: -3000n, pending: true })],
        modified: [],
        removedProviderTransactionIds: [],
        nextCursor: "cursor-1",
        hasMore: false,
      }))),
    );

    // New posted txn arrives carrying pendingTransactionId linking to the prior pending row
    await processPlaidSyncJob(
      { itemId: seeded.itemId },
      fakeOptions(vi.fn(async () => ({
        added: [canonical({ providerTransactionId: "txn-posted", providerAccountId: seeded.checkingProviderAccountId, amountCents: -3000n, pending: false, pendingTransactionId: "txn-pending" })],
        modified: [],
        removedProviderTransactionIds: [],
        nextCursor: "cursor-2",
        hasMore: false,
      }))),
    );

    const rows = await withUserContext(seeded.user.id, (tx) =>
      tx.transaction.findMany({ orderBy: { providerTransactionId: "asc" } }),
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.providerTransactionId === "txn-pending")).toMatchObject({ status: TransactionStatus.removed });
    expect(rows.find((r) => r.providerTransactionId === "txn-posted")).toMatchObject({
      status: TransactionStatus.posted,
      pendingTransactionId: "txn-pending",
    });
  }, 40_000);

  it("still-pending modified transaction with pendingTransactionId does not trigger supersession", async () => {
    const seeded = await seedLinkedItem();

    // Seed an old pending row
    await processPlaidSyncJob(
      { itemId: seeded.itemId },
      fakeOptions(vi.fn(async () => ({
        added: [canonical({ providerTransactionId: "txn-old-pending", providerAccountId: seeded.checkingProviderAccountId, amountCents: -2000n, pending: true })],
        modified: [],
        removedProviderTransactionIds: [],
        nextCursor: "cursor-1",
        hasMore: false,
      }))),
    );

    // A still-pending modified txn arrives carrying pendingTransactionId — supersession must NOT fire
    await processPlaidSyncJob(
      { itemId: seeded.itemId },
      fakeOptions(vi.fn(async () => ({
        added: [],
        modified: [canonical({ providerTransactionId: "txn-new-pending", providerAccountId: seeded.checkingProviderAccountId, amountCents: -2000n, pending: true, pendingTransactionId: "txn-old-pending" })],
        removedProviderTransactionIds: [],
        nextCursor: "cursor-2",
        hasMore: false,
      }))),
    );

    const rows = await withUserContext(seeded.user.id, (tx) =>
      tx.transaction.findMany({ orderBy: { providerTransactionId: "asc" } }),
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.providerTransactionId === "txn-old-pending")).toMatchObject({ status: TransactionStatus.pending });
    expect(rows.find((r) => r.providerTransactionId === "txn-new-pending")).toMatchObject({ status: TransactionStatus.pending, pendingTransactionId: "txn-old-pending" });
  }, 40_000);

  it("same-page in-place post and supersession for the same id: posted row is not overwritten to removed", async () => {
    const seeded = await seedLinkedItem();

    // Seed txn-a as pending
    await processPlaidSyncJob(
      { itemId: seeded.itemId },
      fakeOptions(vi.fn(async () => ({
        added: [canonical({ providerTransactionId: "txn-a", providerAccountId: seeded.checkingProviderAccountId, amountCents: -1000n, pending: true })],
        modified: [],
        removedProviderTransactionIds: [],
        nextCursor: "cursor-1",
        hasMore: false,
      }))),
    );

    // Same page: txn-a in-place posts (modified) AND txn-b arrives with pendingTransactionId="txn-a"
    // The status: pending guard on the supersession updateMany must prevent txn-a from being overwritten to removed
    await processPlaidSyncJob(
      { itemId: seeded.itemId },
      fakeOptions(vi.fn(async () => ({
        added: [canonical({ providerTransactionId: "txn-b", providerAccountId: seeded.checkingProviderAccountId, amountCents: -1000n, pending: false, pendingTransactionId: "txn-a" })],
        modified: [canonical({ providerTransactionId: "txn-a", providerAccountId: seeded.checkingProviderAccountId, amountCents: -1000n, pending: false })],
        removedProviderTransactionIds: [],
        nextCursor: "cursor-2",
        hasMore: false,
      }))),
    );

    const rows = await withUserContext(seeded.user.id, (tx) =>
      tx.transaction.findMany({ orderBy: { providerTransactionId: "asc" } }),
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.providerTransactionId === "txn-a")).toMatchObject({ status: TransactionStatus.posted });
    expect(rows.find((r) => r.providerTransactionId === "txn-b")).toMatchObject({ status: TransactionStatus.posted, pendingTransactionId: "txn-a" });
  }, 40_000);

  it("removed ids: marks matching rows removed (row kept), and re-running the same removal page is idempotent", async () => {
    const seeded = await seedLinkedItem();

    // Seed a posted transaction
    await processPlaidSyncJob(
      { itemId: seeded.itemId },
      fakeOptions(vi.fn(async () => ({
        added: [canonical({ providerTransactionId: "txn-a", providerAccountId: seeded.checkingProviderAccountId, amountCents: -800n })],
        modified: [],
        removedProviderTransactionIds: [],
        nextCursor: "cursor-1",
        hasMore: false,
      }))),
    );

    const removalPage = {
      added: [] as CanonicalTransaction[],
      modified: [] as CanonicalTransaction[],
      removedProviderTransactionIds: ["txn-a"],
      nextCursor: "cursor-2",
      hasMore: false,
    };

    // Run removal page twice (idempotent replay)
    await processPlaidSyncJob({ itemId: seeded.itemId }, fakeOptions(vi.fn(async () => removalPage)));
    await prisma.plaidItem.update({ where: { id: seeded.plaidItem.id }, data: { cursor: "cursor-1" } });
    await processPlaidSyncJob({ itemId: seeded.itemId }, fakeOptions(vi.fn(async () => removalPage)));

    const rows = await withUserContext(seeded.user.id, (tx) => tx.transaction.findMany());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ providerTransactionId: "txn-a", status: TransactionStatus.removed });
  }, 40_000);

  it("unknown removed id is silently ignored", async () => {
    const seeded = await seedLinkedItem();
    await expect(
      processPlaidSyncJob(
        { itemId: seeded.itemId },
        fakeOptions(vi.fn(async () => ({
          added: [],
          modified: [],
          removedProviderTransactionIds: ["unknown-txn-id"],
          nextCursor: "cursor-1",
          hasMore: false,
        }))),
      ),
    ).resolves.toBeUndefined();
    expect(await withUserContext(seeded.user.id, (tx) => tx.transaction.count())).toBe(0);
  }, 40_000);

  it("removed transaction is excluded from category breakdown (regression)", async () => {
    const seeded = await seedLinkedItem();

    // Seed a posted transaction with a category — must appear in breakdown
    await withUserContext(seeded.user.id, (tx) =>
      tx.transaction.create({
        data: {
          accountId: seeded.checking.id,
          userId: seeded.user.id,
          provider: Provider.plaid,
          providerTransactionId: "txn-posted-cat",
          date: new Date("2026-06-10T00:00:00.000Z"),
          amountCents: -5000n,
          direction: TransactionDirection.debit,
          currency: "CAD",
          rawDescription: "Posted transaction",
          status: TransactionStatus.posted,
          category: Category.food_and_dining,
        },
      }),
    );

    // Seed a removed transaction with the same category — must NOT appear in breakdown
    await withUserContext(seeded.user.id, (tx) =>
      tx.transaction.create({
        data: {
          accountId: seeded.checking.id,
          userId: seeded.user.id,
          provider: Provider.plaid,
          providerTransactionId: "txn-removed-cat",
          date: new Date("2026-06-10T00:00:00.000Z"),
          amountCents: -2000n,
          direction: TransactionDirection.debit,
          currency: "CAD",
          rawDescription: "Removed transaction",
          status: TransactionStatus.removed,
          category: Category.food_and_dining,
        },
      }),
    );

    const breakdown = await categoryBreakdown({ userId: seeded.user.id, month: "2026-06" });
    const cad = breakdown.currencies.find((c) => c.currency === "CAD");
    const food = cad?.categories.find((cat) => cat.category === Category.food_and_dining);

    // Only the 5000 posted amount appears; the 2000 removed amount is excluded
    expect(food?.totalCents).toBe(5000);
    expect(food?.transactionCount).toBe(1);
  }, 40_000);

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
