import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import {
  prisma,
  AccountType,
  Category,
  CategorySource,
  Provider,
  TransactionDirection,
} from "@clarifi/shared";
import { createApp } from "../../app.js";

const mocks = vi.hoisted(() => {
  const values = new Map<string, { category: Category; confidence: number }>();
  const state = { failSet: false };
  return {
    values,
    state,
    redisMerchantCategoryCache: {
      async get(input: { userId: string; merchantName: string }) {
        return values.get(`${input.userId}:${input.merchantName}`) ?? null;
      },
      async set(input: { userId: string; merchantName: string; category: Category; confidence: number }) {
        if (state.failSet) throw new Error("cache unavailable");
        values.set(`${input.userId}:${input.merchantName}`, {
          category: input.category,
          confidence: input.confidence,
        });
      },
    },
  };
});

vi.mock("./merchant-cache.js", () => ({
  redisMerchantCategoryCache: mocks.redisMerchantCategoryCache,
}));

const dbUrl = process.env.DATABASE_URL ?? "";
const hasDb = dbUrl.length > 0 && !dbUrl.includes("placeholder");
const app = createApp();
const emails: string[] = [];

async function authenticate(): Promise<{ cookie: string; userId: string }> {
  const email = `override-${randomUUID()}@example.test`;
  emails.push(email);
  const password = "correct-horse-battery";
  await request(app).post("/auth/register").send({ email, password, consent: true });
  const login = await request(app).post("/auth/login").send({ email, password });
  const set = login.headers["set-cookie"];
  const cookies = Array.isArray(set) ? set : set ? [set] : [];
  return { cookie: cookies.map((c) => c.split(";")[0]).join("; "), userId: login.body.id };
}

async function seedTransaction(input: {
  userId: string;
  rawDescription?: string;
  merchantName?: string | null;
  category?: Category | null;
  categorySource?: CategorySource | null;
}) {
  const account = await prisma.account.create({
    data: {
      userId: input.userId,
      provider: Provider.csv,
      providerAccountId: `acct-${randomUUID()}`,
      institutionName: "Override Test Bank",
      accountType: AccountType.checking,
      balanceCents: 0n,
      currency: "CAD",
    },
  });
  const transaction = await prisma.transaction.create({
    data: {
      userId: input.userId,
      accountId: account.id,
      provider: Provider.csv,
      providerTransactionId: `txn-${randomUUID()}`,
      date: new Date("2026-06-01T00:00:00.000Z"),
      amountCents: -450n,
      direction: TransactionDirection.debit,
      currency: "CAD",
      rawDescription: input.rawDescription ?? "TIM HORTONS #1234 VANCOUVER BC",
      merchantName: input.merchantName,
      category: input.category ?? Category.other,
      categorySource: input.categorySource ?? CategorySource.llm,
      categoryConfidence: input.category ? 0.3 : null,
      categorizedAt: input.category ? new Date("2026-06-01T12:00:00.000Z") : null,
    },
  });
  return { account, transaction };
}

afterAll(async () => {
  if (emails.length) await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.$disconnect();
});

beforeEach(() => {
  mocks.values.clear();
  mocks.state.failSet = false;
});

describe.skipIf(!hasDb)("PATCH /transactions/:transactionId/category", () => {
  it("updates category provenance and seeds the merchant cache", async () => {
    const { cookie, userId } = await authenticate();
    const { transaction } = await seedTransaction({
      userId,
      merchantName: "Tim Hortons",
      category: Category.other,
      categorySource: CategorySource.llm,
    });

    const res = await request(app)
      .patch(`/transactions/${transaction.id}/category`)
      .set("Cookie", cookie)
      .send({ category: Category.food_and_dining });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: transaction.id,
      category: Category.food_and_dining,
      categorySource: CategorySource.user,
      categoryConfidence: 1,
      merchantName: "Tim Hortons",
    });
    expect(typeof res.body.categorizedAt).toBe("string");

    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(row.category).toBe(Category.food_and_dining);
    expect(row.categorySource).toBe(CategorySource.user);
    expect(row.categoryConfidence).toBe(1);
    expect(row.merchantName).toBe("Tim Hortons");
    expect(row.rawDescription).toBe("TIM HORTONS #1234 VANCOUVER BC");
    expect(mocks.values.get(`${userId}:Tim Hortons`)).toEqual({
      category: Category.food_and_dining,
      confidence: 1,
    });
  }, 10_000);

  it("normalizes a missing merchant name before seeding the cache", async () => {
    const { cookie, userId } = await authenticate();
    const { transaction } = await seedTransaction({
      userId,
      merchantName: null,
      rawDescription: "STARBUCKS STORE 4421 TORONTO ON",
      category: Category.other,
    });

    const res = await request(app)
      .patch(`/transactions/${transaction.id}/category`)
      .set("Cookie", cookie)
      .send({ category: Category.food_and_dining });

    expect(res.status).toBe(200);
    expect(res.body.merchantName).toBe("Starbucks");
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(row.merchantName).toBe("Starbucks");
    expect(mocks.values.get(`${userId}:Starbucks`)).toEqual({
      category: Category.food_and_dining,
      confidence: 1,
    });
  }, 10_000);

  it("does not seed cache from person-transfer descriptions", async () => {
    const { cookie, userId } = await authenticate();
    const { transaction } = await seedTransaction({
      userId,
      merchantName: null,
      rawDescription: "PAYMENT TO JANE DOE",
      category: Category.other,
    });

    const res = await request(app)
      .patch(`/transactions/${transaction.id}/category`)
      .set("Cookie", cookie)
      .send({ category: Category.transfers });

    expect(res.status).toBe(200);
    expect(res.body.merchantName).toBeNull();
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(row.merchantName).toBeNull();
    expect(row.category).toBe(Category.transfers);
    expect(row.categorySource).toBe(CategorySource.user);
    expect(mocks.values.size).toBe(0);
  }, 10_000);

  it("clears stale merchant names when the raw description is not cache-safe", async () => {
    const { cookie, userId } = await authenticate();
    const { transaction } = await seedTransaction({
      userId,
      merchantName: "Jane Doe",
      rawDescription: "PAYMENT TO JANE DOE",
      category: Category.other,
    });

    const res = await request(app)
      .patch(`/transactions/${transaction.id}/category`)
      .set("Cookie", cookie)
      .send({ category: Category.transfers });

    expect(res.status).toBe(200);
    expect(res.body.merchantName).toBeNull();
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(row.merchantName).toBeNull();
    expect(row.category).toBe(Category.transfers);
    expect(row.categorySource).toBe(CategorySource.user);
    expect(mocks.values.size).toBe(0);
  }, 10_000);

  it("still persists the override when merchant cache seeding fails", async () => {
    const { cookie, userId } = await authenticate();
    const { transaction } = await seedTransaction({
      userId,
      merchantName: "Tim Hortons",
      category: Category.other,
      categorySource: CategorySource.llm,
    });
    mocks.state.failSet = true;

    const res = await request(app)
      .patch(`/transactions/${transaction.id}/category`)
      .set("Cookie", cookie)
      .send({ category: Category.food_and_dining });

    expect(res.status).toBe(200);
    expect(res.body.category).toBe(Category.food_and_dining);
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(row.category).toBe(Category.food_and_dining);
    expect(row.categorySource).toBe(CategorySource.user);
    expect(row.categoryConfidence).toBe(1);
    expect(mocks.values.size).toBe(0);
  }, 10_000);

  it("rejects invalid categories through the validation error contract", async () => {
    const { cookie, userId } = await authenticate();
    const { transaction } = await seedTransaction({ userId });

    const res = await request(app)
      .patch(`/transactions/${transaction.id}/category`)
      .set("Cookie", cookie)
      .send({ category: "not_a_category" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  }, 10_000);

  it("requires authentication", async () => {
    const { userId } = await authenticate();
    const { transaction } = await seedTransaction({ userId });

    const res = await request(app)
      .patch(`/transactions/${transaction.id}/category`)
      .send({ category: Category.shopping });

    expect(res.status).toBe(401);
  }, 10_000);

  it("does not reveal whether a transaction belongs to another user", async () => {
    const owner = await authenticate();
    const other = await authenticate();
    const { transaction } = await seedTransaction({
      userId: owner.userId,
      category: Category.other,
      categorySource: CategorySource.llm,
    });

    const res = await request(app)
      .patch(`/transactions/${transaction.id}/category`)
      .set("Cookie", other.cookie)
      .send({ category: Category.shopping });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("TRANSACTION_NOT_FOUND");
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(row.category).toBe(Category.other);
    expect(row.categorySource).toBe(CategorySource.llm);
    expect(mocks.values.size).toBe(0);
  }, 10_000);

  it("returns not found for missing transactions", async () => {
    const { cookie } = await authenticate();

    const res = await request(app)
      .patch(`/transactions/${randomUUID()}/category`)
      .set("Cookie", cookie)
      .send({ category: Category.shopping });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("TRANSACTION_NOT_FOUND");
  }, 10_000);
});
