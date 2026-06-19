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
  GLOBAL_PRIOR,
  resolveBaseline,
} from "./baselines.js";
import { MIN_SAMPLES } from "./stats.js";

const dbUrl = process.env.DATABASE_URL ?? "";
const hasDb = dbUrl.length > 0 && !dbUrl.includes("placeholder");
const userIds: string[] = [];

async function seedUser() {
  const user = await prisma.user.create({
    data: {
      email: `anomaly-baselines-${randomUUID()}@example.test`,
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
      institutionName: "Baseline Test Bank",
      accountType: AccountType.checking,
      balanceCents: 0n,
      currency: "CAD",
    },
  });
  return { user, account };
}

async function seedTransactions(
  userId: string,
  accountId: string,
  overrides: Array<{
    amountCents: bigint;
    merchantName?: string | null;
    category?: Category | null;
    status?: TransactionStatus;
  }>,
) {
  for (const [i, override] of overrides.entries()) {
    await prisma.transaction.create({
      data: {
        userId,
        accountId,
        provider: Provider.csv,
        providerTransactionId: `txn-baseline-${randomUUID()}-${i}`,
        date: new Date(`2026-0${(i % 6) + 1}-01T00:00:00.000Z`),
        amountCents: override.amountCents,
        direction: override.amountCents < 0n ? TransactionDirection.debit : TransactionDirection.credit,
        currency: "CAD",
        rawDescription: "BASELINE TEST",
        merchantName: override.merchantName ?? null,
        category: override.category ?? null,
        status: override.status ?? TransactionStatus.posted,
      },
    });
  }
}

afterAll(async () => {
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe.skipIf(!hasDb)("resolveBaseline", () => {
  it("returns merchant-level baseline when merchant has >= MIN_SAMPLES transactions", async () => {
    const { user, account } = await seedUser();

    // 6 merchant transactions around -3000 cents
    await seedTransactions(user.id, account.id, [
      { amountCents: -2800n, merchantName: "Tim Hortons", category: Category.food_and_dining },
      { amountCents: -3000n, merchantName: "Tim Hortons", category: Category.food_and_dining },
      { amountCents: -3200n, merchantName: "Tim Hortons", category: Category.food_and_dining },
      { amountCents: -2900n, merchantName: "Tim Hortons", category: Category.food_and_dining },
      { amountCents: -3100n, merchantName: "Tim Hortons", category: Category.food_and_dining },
      { amountCents: -3050n, merchantName: "Tim Hortons", category: Category.food_and_dining },
    ]);

    const result = await withUserContext(user.id, (tx) =>
      resolveBaseline({ userId: user.id, merchantName: "Tim Hortons", category: Category.food_and_dining }, tx),
    );

    expect(result.level).toBe("merchant");
    expect(result.sampleSize).toBe(6);
    // Merchant median is around -3000; shrinkage pulls it slightly toward category/global prior
    expect(result.median).toBeLessThan(0); // debit transaction
  }, 40_000);

  it("falls back to category-level when merchant has fewer than MIN_SAMPLES transactions", async () => {
    const { user, account } = await seedUser();

    // 3 merchant transactions (< MIN_SAMPLES)
    await seedTransactions(user.id, account.id, [
      { amountCents: -500n, merchantName: "Rare Shop", category: Category.shopping },
      { amountCents: -600n, merchantName: "Rare Shop", category: Category.shopping },
      { amountCents: -550n, merchantName: "Rare Shop", category: Category.shopping },
    ]);

    // 6 category transactions (>= MIN_SAMPLES)
    await seedTransactions(user.id, account.id, [
      { amountCents: -1000n, merchantName: "Store A", category: Category.shopping },
      { amountCents: -1200n, merchantName: "Store B", category: Category.shopping },
      { amountCents: -1100n, merchantName: "Store C", category: Category.shopping },
      { amountCents: -1050n, merchantName: "Store D", category: Category.shopping },
      { amountCents: -1150n, merchantName: "Store E", category: Category.shopping },
      { amountCents: -1080n, merchantName: "Store F", category: Category.shopping },
    ]);

    const result = await withUserContext(user.id, (tx) =>
      resolveBaseline({ userId: user.id, merchantName: "Rare Shop", category: Category.shopping }, tx),
    );

    expect(result.level).toBe("category");
    expect(result.sampleSize).toBeGreaterThanOrEqual(MIN_SAMPLES);
  }, 40_000);

  it("falls back to global prior when both merchant and category are thin", async () => {
    const { user, account } = await seedUser();

    // Only 2 transactions total (< MIN_SAMPLES for both merchant and category)
    await seedTransactions(user.id, account.id, [
      { amountCents: -500n, merchantName: "New Place", category: Category.entertainment },
      { amountCents: -600n, merchantName: "New Place", category: Category.entertainment },
    ]);

    const result = await withUserContext(user.id, (tx) =>
      resolveBaseline({ userId: user.id, merchantName: "New Place", category: Category.entertainment }, tx),
    );

    expect(result.level).toBe("global");
    expect(result.median).toBe(GLOBAL_PRIOR.median);
    expect(result.mad).toBe(GLOBAL_PRIOR.mad);
  }, 40_000);

  it("falls back to global prior when merchantName and category are null", async () => {
    const { user } = await seedUser();

    const result = await withUserContext(user.id, (tx) =>
      resolveBaseline({ userId: user.id, merchantName: null, category: null }, tx),
    );

    expect(result.level).toBe("global");
    expect(result.median).toBe(GLOBAL_PRIOR.median);
  }, 40_000);

  it("excludes removed transactions from baselines", async () => {
    const { user, account } = await seedUser();

    // 6 posted transactions at ~-3000
    await seedTransactions(user.id, account.id, [
      { amountCents: -2900n, merchantName: "Coffee Co", category: Category.food_and_dining },
      { amountCents: -3000n, merchantName: "Coffee Co", category: Category.food_and_dining },
      { amountCents: -3100n, merchantName: "Coffee Co", category: Category.food_and_dining },
      { amountCents: -2950n, merchantName: "Coffee Co", category: Category.food_and_dining },
      { amountCents: -3050n, merchantName: "Coffee Co", category: Category.food_and_dining },
      { amountCents: -2980n, merchantName: "Coffee Co", category: Category.food_and_dining },
    ]);

    // 1 removed transaction with a wildly different amount — must not skew baseline
    await seedTransactions(user.id, account.id, [
      { amountCents: -99999n, merchantName: "Coffee Co", category: Category.food_and_dining, status: TransactionStatus.removed },
    ]);

    const result = await withUserContext(user.id, (tx) =>
      resolveBaseline({ userId: user.id, merchantName: "Coffee Co", category: Category.food_and_dining }, tx),
    );

    expect(result.level).toBe("merchant");
    expect(result.sampleSize).toBe(6); // removed transaction excluded from count
    // Median should be near -3000, not skewed by -99999
    expect(result.median).toBeGreaterThan(-3200);
    expect(result.median).toBeLessThan(-2800);
  }, 40_000);

  it("shrinkage pulls merchant baseline toward category prior with few samples", async () => {
    const { user, account } = await seedUser();

    // Exactly MIN_SAMPLES merchant transactions at -10000 (extreme value)
    await seedTransactions(user.id, account.id, Array.from({ length: MIN_SAMPLES }, () => ({
      amountCents: -10000n,
      merchantName: "Expensive Merchant",
      category: Category.shopping,
    })));

    // Many category transactions at -1000 (providing a strong prior)
    await seedTransactions(user.id, account.id, Array.from({ length: 20 }, () => ({
      amountCents: -1000n,
      merchantName: "Other Store",
      category: Category.shopping,
    })));

    const result = await withUserContext(user.id, (tx) =>
      resolveBaseline({ userId: user.id, merchantName: "Expensive Merchant", category: Category.shopping }, tx),
    );

    expect(result.level).toBe("merchant");
    // With sampleSize=5 and confidence=5, shrinkage gives equal weight to observed and prior
    // observed ~-10000, category prior ~-1000 → result should be between the two
    expect(result.median).toBeGreaterThan(-10000);
    expect(result.median).toBeLessThan(-1000);
  }, 40_000);
});
