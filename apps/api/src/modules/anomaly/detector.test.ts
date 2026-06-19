import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  AccountType,
  Category,
  prisma,
  Provider,
  TransactionDirection,
  TransactionStatus,
  withUserContext,
} from "@clarifi/shared";
import {
  VELOCITY_COUNT_THRESHOLD,
  VELOCITY_WINDOW_MINUTES,
  classifyZScoreSeverity,
  detectAnomalies,
  type DetectionInput,
} from "./detector.js";
import { MIN_SAMPLES, MODIFIED_Z_SCORE_THRESHOLD } from "./stats.js";
import { AnomalySeverity, AnomalyType } from "@clarifi/shared";

const dbUrl = process.env.DATABASE_URL ?? "";
const hasDb = dbUrl.length > 0 && !dbUrl.includes("placeholder");
const userIds: string[] = [];

async function seedUser() {
  const user = await prisma.user.create({
    data: {
      email: `anomaly-detector-${randomUUID()}@example.test`,
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
      institutionName: "Detector Test Bank",
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
      providerTransactionId: `txn-detector-${randomUUID()}`,
      date: overrides.date ?? new Date(),
      amountCents: overrides.amountCents,
      direction: overrides.amountCents < 0n ? TransactionDirection.debit : TransactionDirection.credit,
      currency: "CAD",
      rawDescription: "DETECTOR TEST",
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

// ─── Unit tests (no DB) ────────────────────────────────────────────────────

describe("classifyZScoreSeverity", () => {
  it("returns info just above MODIFIED_Z_SCORE_THRESHOLD", () => {
    expect(classifyZScoreSeverity(MODIFIED_Z_SCORE_THRESHOLD + 0.1)).toBe(AnomalySeverity.info);
  });

  it("returns info at the boundary below warning (≤ 2× threshold)", () => {
    expect(classifyZScoreSeverity(MODIFIED_Z_SCORE_THRESHOLD * 2)).toBe(AnomalySeverity.info);
  });

  it("returns warning just above 2× threshold", () => {
    expect(classifyZScoreSeverity(MODIFIED_Z_SCORE_THRESHOLD * 2 + 0.1)).toBe(AnomalySeverity.warning);
  });

  it("returns warning at the boundary below critical (≤ 4× threshold)", () => {
    expect(classifyZScoreSeverity(MODIFIED_Z_SCORE_THRESHOLD * 4)).toBe(AnomalySeverity.warning);
  });

  it("returns critical above 4× threshold", () => {
    expect(classifyZScoreSeverity(MODIFIED_Z_SCORE_THRESHOLD * 4 + 0.1)).toBe(AnomalySeverity.critical);
  });
});

// ─── DB-backed tests ───────────────────────────────────────────────────────

describe.skipIf(!hasDb)("detectAnomalies — velocity", () => {
  it("returns empty when merchantName is null (AC5)", async () => {
    const { user, account } = await seedUser();
    const txn = await createTransaction(user.id, account.id, {
      amountCents: -5000n,
      merchantName: null,
      date: new Date(),
    });

    const input: DetectionInput = {
      transactionId: txn.id,
      userId: user.id,
      merchantName: null,
      category: null,
      amountCents: txn.amountCents,
      occurredAt: txn.date,
    };

    const results = await withUserContext(user.id, (tx) => detectAnomalies(input, tx));
    expect(results).toHaveLength(0);
  }, 40_000);

  it("returns no velocity anomaly when charge count is below threshold", async () => {
    const { user, account } = await seedUser();
    const now = new Date();
    const merchant = "Fraud Merchant A";

    // Seed VELOCITY_COUNT_THRESHOLD - 1 transactions (2 if threshold is 3)
    for (let i = 0; i < VELOCITY_COUNT_THRESHOLD - 1; i++) {
      await createTransaction(user.id, account.id, {
        amountCents: -1000n,
        merchantName: merchant,
        date: new Date(now.getTime() - i * 60_000), // 1 minute apart
      });
    }

    // The "current" transaction
    const txn = await createTransaction(user.id, account.id, {
      amountCents: -1000n,
      merchantName: merchant,
      date: now,
    });

    const input: DetectionInput = {
      transactionId: txn.id,
      userId: user.id,
      merchantName: merchant,
      category: null,
      amountCents: txn.amountCents,
      occurredAt: txn.date,
    };

    const results = await withUserContext(user.id, (tx) => detectAnomalies(input, tx));
    expect(results.some((r) => r.type === AnomalyType.velocity)).toBe(false);
  }, 40_000);

  it("returns velocity warning for exactly VELOCITY_COUNT_THRESHOLD charges in window (AC1)", async () => {
    const { user, account } = await seedUser();
    const now = new Date();
    const merchant = "Fraud Merchant B";

    // Seed threshold - 1 prior charges within the window
    for (let i = 1; i < VELOCITY_COUNT_THRESHOLD; i++) {
      await createTransaction(user.id, account.id, {
        amountCents: -1000n,
        merchantName: merchant,
        date: new Date(now.getTime() - i * 60_000),
      });
    }

    const txn = await createTransaction(user.id, account.id, {
      amountCents: -1000n,
      merchantName: merchant,
      date: now,
    });

    const input: DetectionInput = {
      transactionId: txn.id,
      userId: user.id,
      merchantName: merchant,
      category: null,
      amountCents: txn.amountCents,
      occurredAt: txn.date,
    };

    const results = await withUserContext(user.id, (tx) => detectAnomalies(input, tx));
    const velocity = results.find((r) => r.type === AnomalyType.velocity);
    expect(velocity).toBeDefined();
    expect(velocity?.severity).toBe(AnomalySeverity.warning);
    expect(velocity?.score).toBe(VELOCITY_COUNT_THRESHOLD);
  }, 40_000);

  it("returns velocity critical when count >= threshold + 2 (AC2)", async () => {
    const { user, account } = await seedUser();
    const now = new Date();
    const merchant = "Fraud Merchant C";
    const criticalCount = VELOCITY_COUNT_THRESHOLD + 2; // 5

    for (let i = 1; i < criticalCount; i++) {
      await createTransaction(user.id, account.id, {
        amountCents: -1000n,
        merchantName: merchant,
        date: new Date(now.getTime() - i * 60_000),
      });
    }

    const txn = await createTransaction(user.id, account.id, {
      amountCents: -1000n,
      merchantName: merchant,
      date: now,
    });

    const input: DetectionInput = {
      transactionId: txn.id,
      userId: user.id,
      merchantName: merchant,
      category: null,
      amountCents: txn.amountCents,
      occurredAt: txn.date,
    };

    const results = await withUserContext(user.id, (tx) => detectAnomalies(input, tx));
    const velocity = results.find((r) => r.type === AnomalyType.velocity);
    expect(velocity).toBeDefined();
    expect(velocity?.severity).toBe(AnomalySeverity.critical);
    expect(velocity?.score).toBe(criticalCount);
  }, 40_000);

  it("does not count charges outside the time window", async () => {
    const { user, account } = await seedUser();
    const now = new Date();
    const merchant = "Fraud Merchant D";

    // Seed charges OUTSIDE the velocity window (2 hours ago)
    for (let i = 0; i < VELOCITY_COUNT_THRESHOLD - 1; i++) {
      await createTransaction(user.id, account.id, {
        amountCents: -1000n,
        merchantName: merchant,
        date: new Date(now.getTime() - (VELOCITY_WINDOW_MINUTES + 60) * 60_000),
      });
    }

    const txn = await createTransaction(user.id, account.id, {
      amountCents: -1000n,
      merchantName: merchant,
      date: now,
    });

    const input: DetectionInput = {
      transactionId: txn.id,
      userId: user.id,
      merchantName: merchant,
      category: null,
      amountCents: txn.amountCents,
      occurredAt: txn.date,
    };

    const results = await withUserContext(user.id, (tx) => detectAnomalies(input, tx));
    expect(results.some((r) => r.type === AnomalyType.velocity)).toBe(false);
  }, 40_000);

  it("does not count removed transactions toward velocity", async () => {
    const { user, account } = await seedUser();
    const now = new Date();
    const merchant = "Fraud Merchant E";

    // Seed removed charges (should not count)
    for (let i = 1; i < VELOCITY_COUNT_THRESHOLD; i++) {
      await createTransaction(user.id, account.id, {
        amountCents: -1000n,
        merchantName: merchant,
        date: new Date(now.getTime() - i * 60_000),
        status: TransactionStatus.removed,
      });
    }

    const txn = await createTransaction(user.id, account.id, {
      amountCents: -1000n,
      merchantName: merchant,
      date: now,
    });

    const input: DetectionInput = {
      transactionId: txn.id,
      userId: user.id,
      merchantName: merchant,
      category: null,
      amountCents: txn.amountCents,
      occurredAt: txn.date,
    };

    const results = await withUserContext(user.id, (tx) => detectAnomalies(input, tx));
    expect(results.some((r) => r.type === AnomalyType.velocity)).toBe(false);
  }, 40_000);
});

describe.skipIf(!hasDb)("detectAnomalies — merchant anomaly", () => {
  it("skips merchant anomaly for credit (income) transactions (AC6)", async () => {
    const { user, account } = await seedUser();
    const txn = await createTransaction(user.id, account.id, {
      amountCents: 500000n, // positive = credit
      merchantName: "New Employer",
      category: Category.income,
    });

    const input: DetectionInput = {
      transactionId: txn.id,
      userId: user.id,
      merchantName: "New Employer",
      category: Category.income,
      amountCents: txn.amountCents,
      occurredAt: txn.date,
    };

    const results = await withUserContext(user.id, (tx) => detectAnomalies(input, tx));
    expect(results.some((r) => r.type === AnomalyType.merchant)).toBe(false);
  }, 40_000);

  it("no merchant anomaly when amount is within normal range for new merchant (AC7)", async () => {
    const { user, account } = await seedUser();
    // New merchant but small amount that won't exceed GLOBAL_PRIOR baseline significantly
    // GLOBAL_PRIOR: median=3500, mad=2000. Amount of -3600 cents → z-score ≈ 0.034 (not flagged)
    const txn = await createTransaction(user.id, account.id, {
      amountCents: -3600n,
      merchantName: "Cheap Coffee",
      category: Category.food_and_dining,
    });

    const input: DetectionInput = {
      transactionId: txn.id,
      userId: user.id,
      merchantName: "Cheap Coffee",
      category: Category.food_and_dining,
      amountCents: txn.amountCents,
      occurredAt: txn.date,
    };

    const results = await withUserContext(user.id, (tx) => detectAnomalies(input, tx));
    expect(results.some((r) => r.type === AnomalyType.merchant)).toBe(false);
  }, 40_000);

  it("no merchant anomaly when merchant has >= MIN_SAMPLES prior transactions (AC4)", async () => {
    const { user, account } = await seedUser();
    const merchant = "Established Store";

    // Seed MIN_SAMPLES prior transactions at normal amounts
    for (let i = 0; i < MIN_SAMPLES; i++) {
      await createTransaction(user.id, account.id, {
        amountCents: -5000n,
        merchantName: merchant,
        category: Category.shopping,
      });
    }

    // New transaction with high amount — should NOT trigger merchant anomaly
    const txn = await createTransaction(user.id, account.id, {
      amountCents: -500000n, // $5000
      merchantName: merchant,
      category: Category.shopping,
    });

    const input: DetectionInput = {
      transactionId: txn.id,
      userId: user.id,
      merchantName: merchant,
      category: Category.shopping,
      amountCents: txn.amountCents,
      occurredAt: txn.date,
    };

    const results = await withUserContext(user.id, (tx) => detectAnomalies(input, tx));
    expect(results.some((r) => r.type === AnomalyType.merchant)).toBe(false);
  }, 40_000);

  it("returns merchant anomaly for first-time merchant with high z-score (AC3)", async () => {
    const { user, account } = await seedUser();

    // No prior transactions at "Best Buy" — truly first time
    // Amount: -500000 cents ($5000). GLOBAL_PRIOR: median=3500, mad=2000.
    // absAmount=500000, absMedian=3500, mad=2000
    // z-score = 0.6745 * (500000 - 3500) / 2000 = 167.3 → critical
    const txn = await createTransaction(user.id, account.id, {
      amountCents: -500000n,
      merchantName: "Best Buy",
      category: Category.shopping,
    });

    const input: DetectionInput = {
      transactionId: txn.id,
      userId: user.id,
      merchantName: "Best Buy",
      category: Category.shopping,
      amountCents: txn.amountCents,
      occurredAt: txn.date,
    };

    const results = await withUserContext(user.id, (tx) => detectAnomalies(input, tx));
    const merchant = results.find((r) => r.type === AnomalyType.merchant);
    expect(merchant).toBeDefined();
    expect(merchant?.score).toBeGreaterThan(MODIFIED_Z_SCORE_THRESHOLD);
    expect(merchant?.severity).toBe(AnomalySeverity.critical);
  }, 40_000);

  it("does not count the current transaction as a prior transaction", async () => {
    const { user, account } = await seedUser();
    // Only the current transaction exists at this merchant — priorCount should be 0
    const txn = await createTransaction(user.id, account.id, {
      amountCents: -500000n,
      merchantName: "First And Only Visit",
      category: Category.shopping,
    });

    const input: DetectionInput = {
      transactionId: txn.id,
      userId: user.id,
      merchantName: "First And Only Visit",
      category: Category.shopping,
      amountCents: txn.amountCents,
      occurredAt: txn.date,
    };

    const results = await withUserContext(user.id, (tx) => detectAnomalies(input, tx));
    // Should flag as merchant anomaly (priorCount = 0, large amount)
    expect(results.some((r) => r.type === AnomalyType.merchant)).toBe(true);
  }, 40_000);

  it("uses category baseline when category transactions are present", async () => {
    const { user, account } = await seedUser();
    const merchant = "New Gadget Store";

    // Seed MIN_SAMPLES category transactions at small amounts (~$20 each)
    for (let i = 0; i < MIN_SAMPLES; i++) {
      await createTransaction(user.id, account.id, {
        amountCents: -2000n,
        merchantName: `Electronics Store ${i}`,
        category: Category.shopping,
      });
    }

    // New merchant with a very large amount relative to category baseline
    // Category median ≈ -2000, absolute ≈ 2000
    // Amount: -500000 → z-score = 0.6745 * (500000 - 2000) / MAD >> 3.5 → merchant anomaly
    const txn = await createTransaction(user.id, account.id, {
      amountCents: -500000n,
      merchantName: merchant,
      category: Category.shopping,
    });

    const input: DetectionInput = {
      transactionId: txn.id,
      userId: user.id,
      merchantName: merchant,
      category: Category.shopping,
      amountCents: txn.amountCents,
      occurredAt: txn.date,
    };

    const results = await withUserContext(user.id, (tx) => detectAnomalies(input, tx));
    const merchantResult = results.find((r) => r.type === AnomalyType.merchant);
    expect(merchantResult).toBeDefined();
    expect(merchantResult?.severity).toBe(AnomalySeverity.critical);
  }, 40_000);
});
