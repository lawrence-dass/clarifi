import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  prisma,
  AccountType,
  Category,
  CategorySource,
  Provider,
  TransactionDirection,
} from "@clarifi/shared";
import { config } from "../config.js";
import {
  processCategorizeJob,
  type CategorizationGateway,
  type CategorizationJudge,
} from "./categorize.worker.js";
import type { MerchantCategoryCache } from "../modules/categorization/merchant-cache.js";

const dbUrl = process.env.DATABASE_URL ?? "";
const hasDb = dbUrl.length > 0 && !dbUrl.includes("placeholder");
const emails: string[] = [];
const judgeConfigDefaults = {
  enabled: config.CATEGORIZE_JUDGE_ENABLED,
  minConfidence: config.CATEGORIZE_JUDGE_MIN_CONFIDENCE,
  reviewCeiling: config.CATEGORIZE_JUDGE_REVIEW_CEILING,
};

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

beforeEach(() => {
  config.CATEGORIZE_JUDGE_ENABLED = judgeConfigDefaults.enabled;
  config.CATEGORIZE_JUDGE_MIN_CONFIDENCE = judgeConfigDefaults.minConfidence;
  config.CATEGORIZE_JUDGE_REVIEW_CEILING = judgeConfigDefaults.reviewCeiling;
});

afterEach(() => {
  vi.restoreAllMocks();
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

  it("uses a user-seeded merchant cache entry for later same-merchant transactions", async () => {
    const { user, account, transaction } = await seedTransaction("TIM HORTONS #1234 VANCOUVER BC");
    await prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        merchantName: "Tim Hortons",
        category: Category.shopping,
        categorySource: CategorySource.user,
        categoryConfidence: 1,
        categorizedAt: new Date("2026-06-02T00:00:00.000Z"),
      },
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
    const merchantCache = makeMemoryMerchantCache();
    await merchantCache.set({
      userId: user.id,
      merchantName: "Tim Hortons",
      category: Category.shopping,
      confidence: 1,
    });
    const gateway: CategorizationGateway = {
      categorizeBatch: async () => {
        throw new Error("gateway should not be called for user-seeded cache hits");
      },
    };

    await processCategorizeJob(
      { userId: user.id, accountId: account.id },
      { gateway, merchantCache },
    );

    const userRow = await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    const secondRow = await prisma.transaction.findUniqueOrThrow({ where: { id: second.id } });
    expect(userRow.category).toBe(Category.shopping);
    expect(userRow.categorySource).toBe(CategorySource.user);
    expect(secondRow.category).toBe(Category.shopping);
    expect(secondRow.categorySource).toBe(CategorySource.merchant_cache);
    expect(secondRow.categoryConfidence).toBe(1);
  }, 15_000);

  it("does not overwrite user-overridden transactions", async () => {
    const { user, account, transaction } = await seedTransaction("LOCAL COFFEE ROASTERS VICTORIA BC");
    await prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        merchantName: "Local Coffee Roasters",
        category: Category.shopping,
        categorySource: CategorySource.user,
        categoryConfidence: 1,
        categorizedAt: new Date("2026-06-02T00:00:00.000Z"),
      },
    });
    const gateway: CategorizationGateway = {
      categorizeBatch: async () => [
        { id: transaction.id, category: Category.food_and_dining, confidence: 0.99 },
      ],
    };

    await processCategorizeJob(
      { userId: user.id, accountId: account.id },
      { gateway, merchantCache: makeMemoryMerchantCache() },
    );

    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(row.category).toBe(Category.shopping);
    expect(row.categorySource).toBe(CategorySource.user);
    expect(row.categoryConfidence).toBe(1);
  }, 10_000);

  it("does not seed the merchant cache from 'other' or low-confidence results", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
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

  it("falls back to other and logs when LLM confidence is below the judge floor", async () => {
    config.CATEGORIZE_JUDGE_ENABLED = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { user, account, transaction } = await seedTransaction("TIM HORTONS #1234 VANCOUVER BC");
    const merchantCache = makeMemoryMerchantCache();
    const gateway: CategorizationGateway = {
      categorizeBatch: async () => [
        { id: transaction.id, category: Category.food_and_dining, confidence: 0.49 },
      ],
    };
    const judge: CategorizationJudge = {
      judgeCategorizations: async () => {
        throw new Error("judge should not run for below-floor results");
      },
    };

    await processCategorizeJob(
      { userId: user.id, accountId: account.id },
      { gateway, judge, merchantCache },
    );

    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(row.category).toBe(Category.other);
    expect(row.categorySource).toBe(CategorySource.llm);
    expect(row.categoryConfidence).toBe(0);
    expect(merchantCache.values.size).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      "[categorize] categorization result flagged",
      expect.objectContaining({
        transactionId: transaction.id,
        proposedCategory: Category.food_and_dining,
        confidence: 0.49,
        reason: "below_confidence",
      }),
    );
  }, 10_000);

  it("does not call the judge when judge config is disabled", async () => {
    config.CATEGORIZE_JUDGE_ENABLED = false;
    const { user, account, transaction } = await seedTransaction("LOCAL COFFEE ROASTERS VICTORIA BC");
    const merchantCache = makeMemoryMerchantCache();
    const gateway: CategorizationGateway = {
      categorizeBatch: async () => [
        { id: transaction.id, category: Category.food_and_dining, confidence: 0.7 },
      ],
    };
    const judge: CategorizationJudge = {
      judgeCategorizations: async () => {
        throw new Error("judge should not run when disabled");
      },
    };

    await processCategorizeJob(
      { userId: user.id, accountId: account.id },
      { gateway, judge, merchantCache },
    );

    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(row.category).toBe(Category.food_and_dining);
    expect(row.categoryConfidence).toBe(0.7);
    expect(merchantCache.values.get(`${user.id}:Local Coffee Roasters`)).toEqual({
      category: Category.food_and_dining,
      confidence: 0.7,
    });
  }, 10_000);

  it("keeps and caches in-band categorization when the judge agrees", async () => {
    config.CATEGORIZE_JUDGE_ENABLED = true;
    const { user, account, transaction } = await seedTransaction("LOCAL COFFEE ROASTERS VICTORIA BC");
    const merchantCache = makeMemoryMerchantCache();
    const gateway: CategorizationGateway = {
      categorizeBatch: async () => [
        { id: transaction.id, category: Category.food_and_dining, confidence: 0.7 },
      ],
    };
    const judge: CategorizationJudge = {
      judgeCategorizations: async (items) => {
        expect(items).toEqual([
          {
            id: transaction.id,
            description: "LOCAL COFFEE ROASTERS VICTORIA BC",
            holderName: null,
            proposedCategory: Category.food_and_dining,
          },
        ]);
        return [{ id: transaction.id, agree: true, confidence: 0.91 }];
      },
    };

    await processCategorizeJob(
      { userId: user.id, accountId: account.id },
      { gateway, judge, merchantCache },
    );

    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(row.category).toBe(Category.food_and_dining);
    expect(row.categorySource).toBe(CategorySource.llm);
    expect(row.categoryConfidence).toBe(0.7);
    expect(merchantCache.values.get(`${user.id}:Local Coffee Roasters`)).toEqual({
      category: Category.food_and_dining,
      confidence: 0.7,
    });
  }, 10_000);

  it("keeps the categorizer category but suppresses cache seeding on judge disagreement", async () => {
    config.CATEGORIZE_JUDGE_ENABLED = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { user, account, transaction } = await seedTransaction("LOCAL COFFEE ROASTERS VICTORIA BC");
    const merchantCache = makeMemoryMerchantCache();
    const gateway: CategorizationGateway = {
      categorizeBatch: async () => [
        { id: transaction.id, category: Category.food_and_dining, confidence: 0.7 },
      ],
    };
    const judge: CategorizationJudge = {
      judgeCategorizations: async (items) => {
        expect(items).toEqual([
          {
            id: transaction.id,
            description: "LOCAL COFFEE ROASTERS VICTORIA BC",
            holderName: null,
            proposedCategory: Category.food_and_dining,
          },
        ]);
        return [
          { id: transaction.id, agree: false, suggestedCategory: Category.shopping, confidence: 0.83 },
        ];
      },
    };

    await processCategorizeJob(
      { userId: user.id, accountId: account.id },
      { gateway, judge, merchantCache },
    );

    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(row.category).toBe(Category.food_and_dining);
    expect(row.categorySource).toBe(CategorySource.llm);
    expect(row.categoryConfidence).toBe(0.7);
    expect(merchantCache.values.size).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      "[categorize] categorization judge disagreed",
      {
        transactionId: transaction.id,
        proposedCategory: Category.food_and_dining,
        suggestedCategory: Category.shopping,
        judgeConfidence: 0.83,
      },
    );
  }, 10_000);

  it("continues committing categorization when the judge call fails", async () => {
    config.CATEGORIZE_JUDGE_ENABLED = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { user, account, transaction } = await seedTransaction("LOCAL COFFEE ROASTERS VICTORIA BC");
    const merchantCache = makeMemoryMerchantCache();
    const gateway: CategorizationGateway = {
      categorizeBatch: async () => [
        { id: transaction.id, category: Category.food_and_dining, confidence: 0.7 },
      ],
    };
    const judge: CategorizationJudge = {
      judgeCategorizations: async () => {
        throw new Error("judge provider down");
      },
    };

    await processCategorizeJob(
      { userId: user.id, accountId: account.id },
      { gateway, judge, merchantCache },
    );

    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(row.category).toBe(Category.food_and_dining);
    expect(row.categorySource).toBe(CategorySource.llm);
    expect(merchantCache.values.get(`${user.id}:Local Coffee Roasters`)).toEqual({
      category: Category.food_and_dining,
      confidence: 0.7,
    });
    expect(warn).toHaveBeenCalledWith(
      "[categorize] categorization judge unavailable — proceeding without judge validation",
    );
  }, 10_000);

  it("does not call the judge for merchant-cache hits", async () => {
    config.CATEGORIZE_JUDGE_ENABLED = true;
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
        throw new Error("gateway should not run for cache hits");
      },
    };
    const judge: CategorizationJudge = {
      judgeCategorizations: async () => {
        throw new Error("judge should not run for cache hits");
      },
    };

    await processCategorizeJob(
      { userId: user.id, accountId: account.id },
      { gateway, judge, merchantCache },
    );

    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(row.categorySource).toBe(CategorySource.merchant_cache);
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
    config.CATEGORIZE_JUDGE_ENABLED = true;
    const { user, account, transaction } = await seedTransaction("UNKNOWN MERCHANT");
    const gateway: CategorizationGateway = {
      categorizeBatch: async () => {
        throw new Error("provider down");
      },
    };
    const judge: CategorizationJudge = {
      judgeCategorizations: async () => {
        throw new Error("judge should not run for fallback results");
      },
    };

    await processCategorizeJob(
      { userId: user.id, accountId: account.id },
      { gateway, judge, fallbackOnError: true },
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
