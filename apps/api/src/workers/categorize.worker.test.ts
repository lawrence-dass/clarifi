import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  prisma,
  AccountType,
  Category,
  CategorySource,
  Provider,
  TransactionDirection,
} from "@clarifi/shared";
import { processCategorizeJob, type CategorizationGateway } from "./categorize.worker.js";
import type { MerchantCategoryCache } from "../modules/categorization/merchant-cache.js";

const dbUrl = process.env.DATABASE_URL ?? "";
const hasDb = dbUrl.length > 0 && !dbUrl.includes("placeholder");
const emails: string[] = [];

async function seedTransaction(rawDescription = "COFFEE SHOP") {
  const email = `categorize-${randomUUID()}@example.test`;
  emails.push(email);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: "not-used",
      consentedAt: new Date(),
    },
  });
  const account = await prisma.account.create({
    data: {
      userId: user.id,
      provider: Provider.csv,
      providerAccountId: `acct-${randomUUID()}`,
      institutionName: "Worker Test Bank",
      accountType: AccountType.checking,
      balanceCents: 0n,
      currency: "CAD",
    },
  });
  const transaction = await prisma.transaction.create({
    data: {
      userId: user.id,
      accountId: account.id,
      provider: Provider.csv,
      providerTransactionId: `txn-${randomUUID()}`,
      date: new Date("2026-06-01T00:00:00.000Z"),
      amountCents: -450n,
      direction: TransactionDirection.debit,
      currency: "CAD",
      rawDescription,
    },
  });
  return { user, account, transaction };
}

function makeMemoryMerchantCache(): MerchantCategoryCache & {
  values: Map<string, { category: Category; confidence: number }>;
} {
  const values = new Map<string, { category: Category; confidence: number }>();
  return {
    values,
    async get(input) {
      return values.get(`${input.userId}:${input.merchantName}`) ?? null;
    },
    async set(input) {
      values.set(`${input.userId}:${input.merchantName}`, {
        category: input.category,
        confidence: input.confidence,
      });
    },
  };
}

afterAll(async () => {
  if (emails.length) await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.$disconnect();
});

describe.skipIf(!hasDb)("processCategorizeJob", () => {
  it("writes LLM category provenance fields for uncategorized transactions", async () => {
    const { user, account, transaction } = await seedTransaction();
    const gateway: CategorizationGateway = {
      categorizeBatch: async (items) => {
        expect(items).toEqual([{ id: transaction.id, description: "COFFEE SHOP", holderName: null }]);
        return [{ id: transaction.id, category: Category.food_and_dining, confidence: 0.82 }];
      },
    };

    await processCategorizeJob({ userId: user.id, accountId: account.id }, { gateway });

    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(row.merchantName).toBe("Coffee Shop");
    expect(row.category).toBe(Category.food_and_dining);
    expect(row.categorySource).toBe(CategorySource.llm);
    expect(row.categoryConfidence).toBe(0.82);
    expect(row.categorizedAt).toBeInstanceOf(Date);
  }, 10_000);

  it("uses merchant cache hits without calling the gateway", async () => {
    const { user, account, transaction } = await seedTransaction("TIM HORTONS #1234 VANCOUVER BC");
    const merchantCache = makeMemoryMerchantCache();
    await merchantCache.set({
      userId: user.id,
      merchantName: "Tim Hortons",
      category: Category.food_and_dining,
      confidence: 1,
    });
    const gateway: CategorizationGateway = {
      categorizeBatch: async () => {
        throw new Error("gateway should not be called for cache hits");
      },
    };

    await processCategorizeJob(
      { userId: user.id, accountId: account.id },
      { gateway, merchantCache },
    );

    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(row.merchantName).toBe("Tim Hortons");
    expect(row.category).toBe(Category.food_and_dining);
    expect(row.categorySource).toBe(CategorySource.merchant_cache);
    expect(row.categoryConfidence).toBe(1);
    expect(row.categorizedAt).toBeInstanceOf(Date);
  }, 10_000);

  it("seeds merchant cache from LLM results and uses it for later transactions", async () => {
    const { user, account, transaction } = await seedTransaction("TIM HORTONS #1234 VANCOUVER BC");
    const merchantCache = makeMemoryMerchantCache();
    let gatewayCalls = 0;
    const gateway: CategorizationGateway = {
      categorizeBatch: async (items) => {
        gatewayCalls += 1;
        return items.map((item) => ({
          id: item.id,
          category: Category.food_and_dining,
          confidence: 0.81,
        }));
      },
    };

    await processCategorizeJob(
      { userId: user.id, accountId: account.id },
      { gateway, merchantCache },
    );

    expect(gatewayCalls).toBe(1);
    expect(merchantCache.values.get(`${user.id}:Tim Hortons`)).toEqual({
      category: Category.food_and_dining,
      confidence: 0.81,
    });

    const second = await prisma.transaction.create({
      data: {
        userId: user.id,
        accountId: account.id,
        provider: Provider.csv,
        providerTransactionId: `txn-${randomUUID()}`,
        date: new Date("2026-06-03T00:00:00.000Z"),
        amountCents: -625n,
        direction: TransactionDirection.debit,
        currency: "CAD",
        rawDescription: "TIM HORTONS #5678 BURNABY BC",
      },
    });

    await processCategorizeJob(
      { userId: user.id, accountId: account.id },
      { gateway, merchantCache },
    );

    expect(gatewayCalls).toBe(1);
    const firstRow = await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    const secondRow = await prisma.transaction.findUniqueOrThrow({ where: { id: second.id } });
    expect(firstRow.categorySource).toBe(CategorySource.llm);
    expect(secondRow.categorySource).toBe(CategorySource.merchant_cache);
    expect(secondRow.merchantName).toBe("Tim Hortons");
  }, 15_000);

  it("does not seed the merchant cache from 'other' or low-confidence results", async () => {
    const { user, account } = await seedTransaction("MYSTERY VENDOR LTD");
    const merchantCache = makeMemoryMerchantCache();
    const gateway: CategorizationGateway = {
      categorizeBatch: async (items) =>
        items.map((item) => ({ id: item.id, category: Category.other, confidence: 0.2 })),
    };

    await processCategorizeJob(
      { userId: user.id, accountId: account.id },
      { gateway, merchantCache },
    );

    expect(merchantCache.values.size).toBe(0);
  }, 10_000);

  it("does not derive a merchant name or cache key from person transfers", async () => {
    const { user, account, transaction } = await seedTransaction("PAYMENT TO JANE DOE");
    const merchantCache = makeMemoryMerchantCache();
    const gateway: CategorizationGateway = {
      categorizeBatch: async (items) =>
        items.map((item) => ({ id: item.id, category: Category.transfers, confidence: 0.95 })),
    };

    await processCategorizeJob(
      { userId: user.id, accountId: account.id, holderName: "Jane Doe" },
      { gateway, merchantCache },
    );

    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(row.merchantName).toBeNull();
    expect(row.category).toBe(Category.transfers);
    expect(merchantCache.values.size).toBe(0);
  }, 10_000);

  it("passes holder names from the job through to the gateway for redaction", async () => {
    const { user, account, transaction } = await seedTransaction("PAYMENT TO JANE DOE");
    const gateway: CategorizationGateway = {
      categorizeBatch: async (items) => {
        expect(items).toEqual([
          { id: transaction.id, description: "PAYMENT TO JANE DOE", holderName: "Jane Doe" },
        ]);
        return [{ id: transaction.id, category: Category.transfers, confidence: 0.9 }];
      },
    };

    await processCategorizeJob(
      { userId: user.id, accountId: account.id, holderName: "Jane Doe" },
      { gateway },
    );

    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(row.category).toBe(Category.transfers);
  }, 10_000);

  it("falls back to other on final gateway failure", async () => {
    const { user, account, transaction } = await seedTransaction("UNKNOWN MERCHANT");
    const gateway: CategorizationGateway = {
      categorizeBatch: async () => {
        throw new Error("provider down");
      },
    };

    await processCategorizeJob(
      { userId: user.id, accountId: account.id },
      { gateway, fallbackOnError: true },
    );

    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(row.merchantName).toBe("Unknown Merchant");
    expect(row.category).toBe(Category.other);
    expect(row.categorySource).toBe(CategorySource.llm);
    expect(row.categoryConfidence).toBe(0);
    expect(row.categorizedAt).toBeInstanceOf(Date);
  }, 10_000);

  it("processes every uncategorized transaction across multiple batches", async () => {
    const { user, account, transaction } = await seedTransaction("COFFEE 1");
    const second = await prisma.transaction.create({
      data: {
        userId: user.id,
        accountId: account.id,
        provider: Provider.csv,
        providerTransactionId: `txn-${randomUUID()}`,
        date: new Date("2026-06-02T00:00:00.000Z"),
        amountCents: -550n,
        direction: TransactionDirection.debit,
        currency: "CAD",
        rawDescription: "COFFEE 2",
      },
    });
    const gateway: CategorizationGateway = {
      categorizeBatch: async (items) =>
        items.map((item) => ({
          id: item.id,
          category: Category.food_and_dining,
          confidence: 0.75,
        })),
    };

    await processCategorizeJob(
      { userId: user.id, accountId: account.id },
      { gateway },
    );

    const rows = await prisma.transaction.findMany({
      where: { id: { in: [transaction.id, second.id] } },
      orderBy: { date: "asc" },
    });
    expect(rows.map((row) => row.category)).toEqual([
      Category.food_and_dining,
      Category.food_and_dining,
    ]);
  }, 10_000);
});
