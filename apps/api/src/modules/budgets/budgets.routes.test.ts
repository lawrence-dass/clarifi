import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import {
  prisma,
  AccountType,
  Category,
  CategorySource,
  Provider,
  TransactionDirection,
  TransactionStatus,
} from "@clarifi/shared";
import { createApp } from "../../app.js";

const dbUrl = process.env.DATABASE_URL ?? "";
const hasDb = dbUrl.length > 0 && !dbUrl.includes("placeholder");
const app = createApp();
const emails: string[] = [];

async function authenticate(): Promise<{ cookie: string; userId: string }> {
  const email = `budgets-${randomUUID()}@example.test`;
  emails.push(email);
  const password = "correct-horse-battery";
  await request(app).post("/auth/register").send({ email, password, consent: true });
  const login = await request(app).post("/auth/login").send({ email, password });
  const set = login.headers["set-cookie"];
  const cookies = Array.isArray(set) ? set : set ? [set] : [];
  return { cookie: cookies.map((cookie) => cookie.split(";")[0]).join("; "), userId: login.body.id };
}

async function seedAccount(userId: string, currency = "CAD") {
  return prisma.account.create({
    data: {
      userId,
      provider: Provider.csv,
      providerAccountId: `acct-${randomUUID()}`,
      institutionName: "Budgets Test Bank",
      accountType: AccountType.checking,
      balanceCents: 0n,
      currency,
    },
  });
}

async function seedTransaction(input: {
  userId: string;
  accountId: string;
  date: string;
  amountCents: bigint;
  direction: TransactionDirection;
  currency: string;
  category: Category | null;
  status?: TransactionStatus;
}) {
  return prisma.transaction.create({
    data: {
      userId: input.userId,
      accountId: input.accountId,
      provider: Provider.csv,
      providerTransactionId: `txn-${randomUUID()}`,
      date: new Date(input.date),
      amountCents: input.amountCents,
      direction: input.direction,
      currency: input.currency,
      rawDescription: `BUDGETS TEST ${randomUUID()}`,
      category: input.category,
      categorySource: input.category ? CategorySource.llm : null,
      categoryConfidence: input.category ? 0.9 : null,
      categorizedAt: input.category ? new Date(input.date) : null,
      status: input.status ?? TransactionStatus.posted,
    },
  });
}

afterAll(async () => {
  if (emails.length) await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.$disconnect();
});

describe.skipIf(!hasDb)("PUT /budgets", () => {
  it("creates then updates the same category/month budget without trusting body userId", async () => {
    const owner = await authenticate();
    const other = await authenticate();

    const create = await request(app)
      .put("/budgets")
      .set("Cookie", owner.cookie)
      .send({
        userId: other.userId,
        category: Category.food_and_dining,
        month: "2026-06",
        monthlyLimitCents: 60000,
      });

    expect(create.status).toBe(200);
    expect(create.body).toMatchObject({
      category: Category.food_and_dining,
      month: "2026-06",
      monthlyLimitCents: 60000,
    });
    expect(create.body.id).toEqual(expect.any(String));

    const update = await request(app)
      .put("/budgets")
      .set("Cookie", owner.cookie)
      .send({
        userId: other.userId,
        category: Category.food_and_dining,
        month: "2026-06",
        monthlyLimitCents: 75000,
      });

    expect(update.status).toBe(200);
    expect(update.body).toEqual({
      id: create.body.id,
      category: Category.food_and_dining,
      month: "2026-06",
      monthlyLimitCents: 75000,
    });

    const ownerRows = await prisma.budget.findMany({
      where: { userId: owner.userId, category: Category.food_and_dining, month: "2026-06" },
    });
    const otherRows = await prisma.budget.findMany({
      where: { userId: other.userId, category: Category.food_and_dining, month: "2026-06" },
    });
    expect(ownerRows).toHaveLength(1);
    expect(ownerRows[0]?.monthlyLimitCents).toBe(75000n);
    expect(otherRows).toHaveLength(0);
  }, 20_000);

  it("returns 400 for invalid category, month, and monthlyLimitCents", async () => {
    const { cookie } = await authenticate();

    const invalidCategory = await request(app)
      .put("/budgets")
      .set("Cookie", cookie)
      .send({ category: "not_a_category", month: "2026-06", monthlyLimitCents: 60000 });
    const invalidMonth = await request(app)
      .put("/budgets")
      .set("Cookie", cookie)
      .send({ category: Category.transport, month: "2026-13", monthlyLimitCents: 60000 });
    const zeroLimit = await request(app)
      .put("/budgets")
      .set("Cookie", cookie)
      .send({ category: Category.transport, month: "2026-06", monthlyLimitCents: 0 });
    const decimalLimit = await request(app)
      .put("/budgets")
      .set("Cookie", cookie)
      .send({ category: Category.transport, month: "2026-06", monthlyLimitCents: 123.45 });
    const unsafeLimit = await request(app)
      .put("/budgets")
      .set("Cookie", cookie)
      .send({
        category: Category.transport,
        month: "2026-06",
        monthlyLimitCents: Number.MAX_SAFE_INTEGER + 1,
      });

    for (const res of [invalidCategory, invalidMonth, zeroLimit, decimalLimit, unsafeLimit]) {
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_BUDGET");
    }
  }, 20_000);

  it("requires authentication", async () => {
    const res = await request(app)
      .put("/budgets")
      .send({ category: Category.shopping, month: "2026-06", monthlyLimitCents: 10000 });

    expect(res.status).toBe(401);
  }, 10_000);
});

describe.skipIf(!hasDb)("GET /budgets", () => {
  it("returns live CAD progress with under, exact, and over-budget math", async () => {
    const owner = await authenticate();
    const other = await authenticate();
    const cadAccount = await seedAccount(owner.userId, "CAD");
    const usdAccount = await seedAccount(owner.userId, "USD");
    const otherAccount = await seedAccount(other.userId, "CAD");

    await prisma.budget.createMany({
      data: [
        {
          userId: owner.userId,
          category: Category.food_and_dining,
          month: "2026-06",
          monthlyLimitCents: 10000n,
        },
        {
          userId: owner.userId,
          category: Category.transport,
          month: "2026-06",
          monthlyLimitCents: 5000n,
        },
        {
          userId: owner.userId,
          category: Category.shopping,
          month: "2026-06",
          monthlyLimitCents: 3000n,
        },
        {
          userId: owner.userId,
          category: Category.health,
          month: "2026-06",
          monthlyLimitCents: 4000n,
        },
        {
          userId: owner.userId,
          category: Category.travel,
          month: "2026-05",
          monthlyLimitCents: 9999n,
        },
        {
          userId: other.userId,
          category: Category.food_and_dining,
          month: "2026-06",
          monthlyLimitCents: 1111n,
        },
      ],
    });

    await seedTransaction({
      userId: owner.userId,
      accountId: cadAccount.id,
      date: "2026-06-05T12:00:00.000Z",
      amountCents: -2500n,
      direction: TransactionDirection.debit,
      currency: "CAD",
      category: Category.food_and_dining,
    });
    await seedTransaction({
      userId: owner.userId,
      accountId: cadAccount.id,
      date: "2026-06-06T12:00:00.000Z",
      amountCents: -2500n,
      direction: TransactionDirection.debit,
      currency: "CAD",
      category: Category.food_and_dining,
    });
    await seedTransaction({
      userId: owner.userId,
      accountId: cadAccount.id,
      date: "2026-06-07T12:00:00.000Z",
      amountCents: -5000n,
      direction: TransactionDirection.debit,
      currency: "CAD",
      category: Category.transport,
    });
    await seedTransaction({
      userId: owner.userId,
      accountId: cadAccount.id,
      date: "2026-06-08T12:00:00.000Z",
      amountCents: -4500n,
      direction: TransactionDirection.debit,
      currency: "CAD",
      category: Category.shopping,
    });
    await seedTransaction({
      userId: owner.userId,
      accountId: usdAccount.id,
      date: "2026-06-09T12:00:00.000Z",
      amountCents: -9999n,
      direction: TransactionDirection.debit,
      currency: "USD",
      category: Category.food_and_dining,
    });
    await seedTransaction({
      userId: owner.userId,
      accountId: cadAccount.id,
      date: "2026-05-31T23:59:59.999Z",
      amountCents: -8888n,
      direction: TransactionDirection.debit,
      currency: "CAD",
      category: Category.food_and_dining,
    });
    await seedTransaction({
      userId: owner.userId,
      accountId: cadAccount.id,
      date: "2026-06-10T12:00:00.000Z",
      amountCents: 7777n,
      direction: TransactionDirection.credit,
      currency: "CAD",
      category: Category.food_and_dining,
    });
    await seedTransaction({
      userId: owner.userId,
      accountId: cadAccount.id,
      date: "2026-06-11T12:00:00.000Z",
      amountCents: -6666n,
      direction: TransactionDirection.debit,
      currency: "CAD",
      category: Category.food_and_dining,
      status: TransactionStatus.removed,
    });
    await seedTransaction({
      userId: other.userId,
      accountId: otherAccount.id,
      date: "2026-06-12T12:00:00.000Z",
      amountCents: -999999n,
      direction: TransactionDirection.debit,
      currency: "CAD",
      category: Category.food_and_dining,
    });
    await seedTransaction({
      userId: owner.userId,
      accountId: cadAccount.id,
      date: "2026-06-13T12:00:00.000Z",
      amountCents: -1234n,
      direction: TransactionDirection.debit,
      currency: "CAD",
      category: Category.utilities,
    });

    const res = await request(app)
      .get("/budgets")
      .query({ month: "2026-06" })
      .set("Cookie", owner.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      month: "2026-06",
      currency: "CAD",
      budgets: [
        {
          category: Category.food_and_dining,
          month: "2026-06",
          monthlyLimitCents: 10000,
          spentCents: 5000,
          remainingCents: 5000,
          percentUsed: 50,
          currency: "CAD",
        },
        {
          category: Category.health,
          month: "2026-06",
          monthlyLimitCents: 4000,
          spentCents: 0,
          remainingCents: 4000,
          percentUsed: 0,
          currency: "CAD",
        },
        {
          category: Category.shopping,
          month: "2026-06",
          monthlyLimitCents: 3000,
          spentCents: 4500,
          remainingCents: -1500,
          percentUsed: 150,
          currency: "CAD",
        },
        {
          category: Category.transport,
          month: "2026-06",
          monthlyLimitCents: 5000,
          spentCents: 5000,
          remainingCents: 0,
          percentUsed: 100,
          currency: "CAD",
        },
      ],
    });

    await seedTransaction({
      userId: owner.userId,
      accountId: cadAccount.id,
      date: "2026-06-14T12:00:00.000Z",
      amountCents: -1000n,
      direction: TransactionDirection.debit,
      currency: "CAD",
      category: Category.food_and_dining,
    });

    const recomputed = await request(app)
      .get("/budgets")
      .query({ month: "2026-06" })
      .set("Cookie", owner.cookie);

    expect(recomputed.status).toBe(200);
    expect(recomputed.body.budgets[0]).toMatchObject({
      category: Category.food_and_dining,
      spentCents: 6000,
      remainingCents: 4000,
      percentUsed: 60,
    });
    expect(recomputed.body.budgets).not.toContainEqual(expect.objectContaining({
      category: Category.utilities,
    }));
  }, 30_000);

  it("returns 400 for missing or malformed month values", async () => {
    const { cookie } = await authenticate();

    const missing = await request(app).get("/budgets").set("Cookie", cookie);
    const malformed = await request(app)
      .get("/budgets")
      .query({ month: "2026-13" })
      .set("Cookie", cookie);

    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe("INVALID_MONTH");
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe("INVALID_MONTH");
  }, 10_000);

  it("requires authentication", async () => {
    const res = await request(app).get("/budgets").query({ month: "2026-06" });

    expect(res.status).toBe(401);
  }, 10_000);
});
