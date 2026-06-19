import { afterAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  AccountType,
  AnomalySeverity,
  AnomalyType,
  Category,
  prisma,
  Provider,
  TransactionDirection,
  TransactionStatus,
  withUserContext,
} from "@clarifi/shared";
import { detectAndPersist } from "./persist.js";
import type { DetectionInput } from "./detector.js";

// Mock the explain queue so detectAndPersist never reaches Redis. With a dead
// REDIS_URL host the enqueue hangs on DNS retries (not a thrown error the
// try/catch can swallow), which previously timed these DB tests out at 40s.
vi.mock("../../queues/anomaly-explain.queue.js", () => ({
  enqueueAnomalyExplain: vi.fn(async () => undefined),
}));

const dbUrl = process.env.DATABASE_URL ?? "";
const hasDb = dbUrl.length > 0 && !dbUrl.includes("placeholder");
const userIds: string[] = [];

async function seedUser() {
  const user = await prisma.user.create({
    data: {
      email: `anomaly-persist-${randomUUID()}@example.test`,
      passwordHash: "hashed-password",
      consentedAt: new Date("2026-06-01T00:00:00.000Z"),
    },
  });
  userIds.push(user.id);
  const account = await prisma.account.create({
    data: {
      userId: user.id,
      provider: Provider.csv,
      providerAccountId: `acct-${randomUUID()}`,
      institutionName: "Persist Test Bank",
      accountType: AccountType.checking,
      balanceCents: 0n,
      currency: "CAD",
    },
  });
  return { user, account };
}

async function createTransaction(
  userId: string,
  accountId: string,
  overrides: {
    amountCents: bigint;
    merchantName?: string | null;
    category?: Category | null;
    date?: Date;
    status?: TransactionStatus;
  },
) {
  return prisma.transaction.create({
    data: {
      userId,
      accountId,
      provider: Provider.csv,
      providerTransactionId: `txn-persist-${randomUUID()}`,
      date: overrides.date ?? new Date(),
      amountCents: overrides.amountCents,
      direction: overrides.amountCents < 0n ? TransactionDirection.debit : TransactionDirection.credit,
      currency: "CAD",
      rawDescription: "PERSIST TEST",
      merchantName: overrides.merchantName ?? null,
      category: overrides.category ?? null,
      status: overrides.status ?? TransactionStatus.posted,
    },
  });
}

afterAll(async () => {
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe.skipIf(!hasDb)("detectAndPersist", () => {
  it("creates Anomaly rows and sets isAnomaly=true for a flagged transaction", async () => {
    const { user, account } = await seedUser();

    // New merchant + very large amount → merchant anomaly
    const txn = await createTransaction(user.id, account.id, {
      amountCents: -500000n,
      merchantName: "New Expensive Store",
      category: Category.shopping,
    });

    const input: DetectionInput = {
      transactionId: txn.id,
      userId: user.id,
      merchantName: "New Expensive Store",
      category: Category.shopping,
      amountCents: txn.amountCents,
      occurredAt: txn.date,
    };

    await withUserContext(user.id, (tx) => detectAndPersist(input, tx));

    const updated = await prisma.transaction.findUniqueOrThrow({ where: { id: txn.id } });
    expect(updated.isAnomaly).toBe(true);

    const anomalies = await prisma.anomaly.findMany({ where: { transactionId: txn.id } });
    expect(anomalies.length).toBeGreaterThan(0);
    expect(anomalies[0]?.type).toBe(AnomalyType.merchant);
    expect(anomalies[0]?.dismissed).toBe(false);
    expect(anomalies[0]?.reportedSuspicious).toBe(false);
    expect(anomalies[0]?.explanation).toBeNull();
  }, 40_000);

  it("does not create Anomaly rows and leaves isAnomaly=false for a normal transaction", async () => {
    const { user, account } = await seedUser();

    // Small amount at new merchant — no anomaly expected (z-score < 3.5)
    const txn = await createTransaction(user.id, account.id, {
      amountCents: -3600n, // ~$36, close to GLOBAL_PRIOR median of $35
      merchantName: "Normal Coffee",
      category: Category.food_and_dining,
    });

    const input: DetectionInput = {
      transactionId: txn.id,
      userId: user.id,
      merchantName: "Normal Coffee",
      category: Category.food_and_dining,
      amountCents: txn.amountCents,
      occurredAt: txn.date,
    };

    await withUserContext(user.id, (tx) => detectAndPersist(input, tx));

    const updated = await prisma.transaction.findUniqueOrThrow({ where: { id: txn.id } });
    expect(updated.isAnomaly).toBe(false);

    const anomalies = await prisma.anomaly.findMany({ where: { transactionId: txn.id } });
    expect(anomalies).toHaveLength(0);
  }, 40_000);

  it("creates multiple Anomaly rows when velocity and merchant both fire", async () => {
    const { user, account } = await seedUser();
    const now = new Date();
    const merchant = "Repeated Expensive Merchant";

    // Two prior velocity charges within the window
    for (let i = 1; i < 3; i++) {
      await createTransaction(user.id, account.id, {
        amountCents: -500000n,
        merchantName: merchant,
        category: Category.shopping,
        date: new Date(now.getTime() - i * 60_000),
      });
    }

    // Current transaction — third charge (velocity) AND new merchant (merchant anomaly)
    const txn = await createTransaction(user.id, account.id, {
      amountCents: -500000n,
      merchantName: merchant,
      category: Category.shopping,
      date: now,
    });

    const input: DetectionInput = {
      transactionId: txn.id,
      userId: user.id,
      merchantName: merchant,
      category: Category.shopping,
      amountCents: txn.amountCents,
      occurredAt: txn.date,
    };

    await withUserContext(user.id, (tx) => detectAndPersist(input, tx));

    const anomalies = await prisma.anomaly.findMany({ where: { transactionId: txn.id } });
    const types = anomalies.map((a) => a.type);
    expect(types).toContain(AnomalyType.velocity);
    expect(types).toContain(AnomalyType.merchant);
  }, 40_000);

  it("anomaly severity is set correctly from z-score classification", async () => {
    const { user, account } = await seedUser();

    // Extreme amount → critical severity
    const txn = await createTransaction(user.id, account.id, {
      amountCents: -500000n, // $5000 vs ~$35 global prior → z-score ≈ 167 → critical
      merchantName: "Critical Vendor",
      category: Category.shopping,
    });

    const input: DetectionInput = {
      transactionId: txn.id,
      userId: user.id,
      merchantName: "Critical Vendor",
      category: Category.shopping,
      amountCents: txn.amountCents,
      occurredAt: txn.date,
    };

    await withUserContext(user.id, (tx) => detectAndPersist(input, tx));

    const anomaly = await prisma.anomaly.findFirst({
      where: { transactionId: txn.id, type: AnomalyType.merchant },
    });
    expect(anomaly?.severity).toBe(AnomalySeverity.critical);
  }, 40_000);
});
