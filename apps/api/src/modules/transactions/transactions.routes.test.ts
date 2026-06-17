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
  const email = `breakdown-${randomUUID()}@example.test`;
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
      institutionName: "Breakdown Test Bank",
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
      rawDescription: `BREAKDOWN TEST ${randomUUID()}`,
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

describe.skipIf(!hasDb)("GET /transactions/category-breakdown", () => {
  it("returns isolated per-currency category spending sorted by category total", async () => {
    const owner = await authenticate();
    const other = await authenticate();
    const cadAccount = await seedAccount(owner.userId, "CAD");
    const usdAccount = await seedAccount(owner.userId, "USD");
    const otherAccount = await seedAccount(other.userId, "CAD");

    await seedTransaction({
      userId: owner.userId,
      accountId: cadAccount.id,
      date: "2026-06-01T00:00:00.000Z",
      amountCents: -2500n,
      direction: TransactionDirection.debit,
      currency: "CAD",
      category: Category.food_and_dining,
    });
    await seedTransaction({
      userId: owner.userId,
      accountId: cadAccount.id,
      date: "2026-06-30T23:59:59.999Z",
      amountCents: -750n,
      direction: TransactionDirection.debit,
      currency: "CAD",
      category: Category.food_and_dining,
    });
    await seedTransaction({
      userId: owner.userId,
      accountId: cadAccount.id,
      date: "2026-06-15T12:00:00.000Z",
      amountCents: -1200n,
      direction: TransactionDirection.debit,
      currency: "CAD",
      category: Category.transport,
    });
    await seedTransaction({
      userId: owner.userId,
      accountId: usdAccount.id,
      date: "2026-06-20T12:00:00.000Z",
      amountCents: -8000n,
      direction: TransactionDirection.debit,
      currency: "USD",
      category: Category.travel,
    });
    await seedTransaction({
      userId: owner.userId,
      accountId: cadAccount.id,
      date: "2026-06-10T12:00:00.000Z",
      amountCents: 999999n,
      direction: TransactionDirection.credit,
      currency: "CAD",
      category: Category.income,
    });
    await seedTransaction({
      userId: owner.userId,
      accountId: cadAccount.id,
      date: "2026-06-11T12:00:00.000Z",
      amountCents: -5000n,
      direction: TransactionDirection.debit,
      currency: "CAD",
      category: Category.shopping,
      status: TransactionStatus.removed,
    });
    await seedTransaction({
      userId: owner.userId,
      accountId: cadAccount.id,
      date: "2026-06-12T12:00:00.000Z",
      amountCents: -3300n,
      direction: TransactionDirection.debit,
      currency: "CAD",
      category: null,
    });
    await seedTransaction({
      userId: owner.userId,
      accountId: cadAccount.id,
      date: "2026-07-01T00:00:00.000Z",
      amountCents: -9100n,
      direction: TransactionDirection.debit,
      currency: "CAD",
      category: Category.housing,
    });
    await seedTransaction({
      userId: other.userId,
      accountId: otherAccount.id,
      date: "2026-06-15T12:00:00.000Z",
      amountCents: -9999n,
      direction: TransactionDirection.debit,
      currency: "CAD",
      category: Category.food_and_dining,
    });

    const res = await request(app)
      .get("/transactions/category-breakdown")
      .query({ month: "2026-06" })
      .set("Cookie", owner.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      month: "2026-06",
      currencies: [
        {
          currency: "CAD",
          totalCents: 4450,
          categories: [
            { category: Category.food_and_dining, totalCents: 3250, transactionCount: 2 },
            { category: Category.transport, totalCents: 1200, transactionCount: 1 },
          ],
        },
        {
          currency: "USD",
          totalCents: 8000,
          categories: [
            { category: Category.travel, totalCents: 8000, transactionCount: 1 },
          ],
        },
      ],
    });
    for (const bucket of res.body.currencies) {
      expect(Number.isInteger(bucket.totalCents)).toBe(true);
      for (const category of bucket.categories) {
        expect(Number.isInteger(category.totalCents)).toBe(true);
        expect(category.totalCents).toBeGreaterThan(0);
      }
    }
  }, 20_000);

  it("returns an empty currency list for a month with no matching spend", async () => {
    const { cookie } = await authenticate();

    const res = await request(app)
      .get("/transactions/category-breakdown")
      .query({ month: "2026-05" })
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ month: "2026-05", currencies: [] });
  }, 10_000);

  it("returns 400 for missing or malformed month values", async () => {
    const { cookie } = await authenticate();

    const missing = await request(app)
      .get("/transactions/category-breakdown")
      .set("Cookie", cookie);
    const malformed = await request(app)
      .get("/transactions/category-breakdown")
      .query({ month: "2026-13" })
      .set("Cookie", cookie);

    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe("INVALID_MONTH");
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe("INVALID_MONTH");
  }, 10_000);

  it("requires authentication", async () => {
    const res = await request(app)
      .get("/transactions/category-breakdown")
      .query({ month: "2026-06" });

    expect(res.status).toBe(401);
  }, 10_000);
});

describe.skipIf(!hasDb)("GET /transactions/spending-trend", () => {
  it("returns dense six-month per-currency spend series with zero-filled gaps", async () => {
    const owner = await authenticate();
    const other = await authenticate();
    const cadAccount = await seedAccount(owner.userId, "CAD");
    const usdAccount = await seedAccount(owner.userId, "USD");
    const otherAccount = await seedAccount(other.userId, "CAD");

    await seedTransaction({
      userId: owner.userId,
      accountId: cadAccount.id,
      date: "2026-01-15T12:00:00.000Z",
      amountCents: -1000n,
      direction: TransactionDirection.debit,
      currency: "CAD",
      category: null,
    });
    await seedTransaction({
      userId: owner.userId,
      accountId: cadAccount.id,
      date: "2026-03-02T12:00:00.000Z",
      amountCents: -2500n,
      direction: TransactionDirection.debit,
      currency: "CAD",
      category: Category.food_and_dining,
    });
    await seedTransaction({
      userId: owner.userId,
      accountId: usdAccount.id,
      date: "2026-05-20T12:00:00.000Z",
      amountCents: -700n,
      direction: TransactionDirection.debit,
      currency: "USD",
      category: Category.shopping,
    });
    await seedTransaction({
      userId: owner.userId,
      accountId: cadAccount.id,
      date: "2026-06-01T00:00:00.000Z",
      amountCents: -4000n,
      direction: TransactionDirection.debit,
      currency: "CAD",
      category: Category.transport,
    });
    await seedTransaction({
      userId: owner.userId,
      accountId: cadAccount.id,
      date: "2026-06-15T12:00:00.000Z",
      amountCents: 999999n,
      direction: TransactionDirection.credit,
      currency: "CAD",
      category: Category.income,
    });
    await seedTransaction({
      userId: owner.userId,
      accountId: cadAccount.id,
      date: "2026-06-16T12:00:00.000Z",
      amountCents: -8888n,
      direction: TransactionDirection.debit,
      currency: "CAD",
      category: Category.shopping,
      status: TransactionStatus.removed,
    });
    await seedTransaction({
      userId: owner.userId,
      accountId: cadAccount.id,
      date: "2025-12-31T23:59:59.999Z",
      amountCents: -2222n,
      direction: TransactionDirection.debit,
      currency: "CAD",
      category: Category.housing,
    });
    await seedTransaction({
      userId: other.userId,
      accountId: otherAccount.id,
      date: "2026-06-15T12:00:00.000Z",
      amountCents: -123456n,
      direction: TransactionDirection.debit,
      currency: "CAD",
      category: Category.food_and_dining,
    });

    const res = await request(app)
      .get("/transactions/spending-trend")
      .query({ endMonth: "2026-06" })
      .set("Cookie", owner.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      months: ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"],
      currencies: [
        {
          currency: "CAD",
          totals: [
            { month: "2026-01", totalCents: 1000 },
            { month: "2026-02", totalCents: 0 },
            { month: "2026-03", totalCents: 2500 },
            { month: "2026-04", totalCents: 0 },
            { month: "2026-05", totalCents: 0 },
            { month: "2026-06", totalCents: 4000 },
          ],
        },
        {
          currency: "USD",
          totals: [
            { month: "2026-01", totalCents: 0 },
            { month: "2026-02", totalCents: 0 },
            { month: "2026-03", totalCents: 0 },
            { month: "2026-04", totalCents: 0 },
            { month: "2026-05", totalCents: 700 },
            { month: "2026-06", totalCents: 0 },
          ],
        },
      ],
    });
    for (const bucket of res.body.currencies) {
      expect(bucket.totals).toHaveLength(6);
      for (const total of bucket.totals) {
        expect(Number.isInteger(total.totalCents)).toBe(true);
        expect(total.totalCents).toBeGreaterThanOrEqual(0);
      }
    }
  }, 20_000);

  it("returns a populated axis and empty currencies for an empty window", async () => {
    const { cookie } = await authenticate();

    const res = await request(app)
      .get("/transactions/spending-trend")
      .query({ endMonth: "2026-06" })
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      months: ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"],
      currencies: [],
    });
  }, 10_000);

  it("defaults endMonth to the current UTC month when omitted", async () => {
    const { cookie } = await authenticate();
    const now = new Date();
    const currentUtcMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

    const res = await request(app)
      .get("/transactions/spending-trend")
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.months).toHaveLength(6);
    expect(res.body.months[5]).toBe(currentUtcMonth);
    expect(res.body.currencies).toEqual([]);
  }, 10_000);

  it("returns 400 for malformed endMonth values", async () => {
    const { cookie } = await authenticate();

    const res = await request(app)
      .get("/transactions/spending-trend")
      .query({ endMonth: "2026-13" })
      .set("Cookie", cookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_MONTH");
  }, 10_000);

  it("requires authentication", async () => {
    const res = await request(app)
      .get("/transactions/spending-trend")
      .query({ endMonth: "2026-06" });

    expect(res.status).toBe(401);
  }, 10_000);
});
