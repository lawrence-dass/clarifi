import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import {
  AccountType,
  Category,
  prisma,
  Provider,
  TransactionDirection,
  TransactionStatus,
} from "@clarifi/shared";
import { createApp } from "../../app.js";

const dbUrl = process.env.DATABASE_URL ?? "";
const hasDb = dbUrl.length > 0 && !dbUrl.includes("placeholder");
const app = createApp();
const emails: string[] = [];

afterAll(async () => {
  if (emails.length) await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.$disconnect();
});

async function authenticate(): Promise<{ cookie: string; userId: string }> {
  const email = `fdx-routes-${randomUUID()}@example.test`;
  emails.push(email);
  const password = "correct-horse-battery";
  await request(app).post("/auth/register").send({ email, password, consent: true });
  const login = await request(app).post("/auth/login").send({ email, password });
  const set = login.headers["set-cookie"];
  const cookies = Array.isArray(set) ? set : set ? [set] : [];
  return { cookie: cookies.map((c: string) => c.split(";")[0]).join("; "), userId: login.body.id };
}

async function seedAccount(userId: string) {
  return prisma.account.create({
    data: {
      userId,
      provider: Provider.csv,
      providerAccountId: `fdx-acct-${randomUUID()}`,
      institutionName: "FDX Test Bank",
      accountType: AccountType.checking,
      balanceCents: 500000n,
      currency: "CAD",
    },
  });
}

async function seedTransaction(userId: string, accountId: string) {
  return prisma.transaction.create({
    data: {
      userId,
      accountId,
      provider: Provider.csv,
      providerTransactionId: `fdx-txn-${randomUUID()}`,
      date: new Date("2026-06-10"),
      amountCents: -2500n,
      direction: TransactionDirection.debit,
      currency: "CAD",
      rawDescription: "FDX TEST STORE",
      merchantName: "FDX Store",
      category: Category.shopping,
      status: TransactionStatus.posted,
    },
  });
}

describe("GET /fdx/accounts — auth check", () => {
  it("returns 401 without authentication", async () => {
    const res = await request(app).get("/fdx/accounts");
    expect(res.status).toBe(401);
  });
});

describe("GET /fdx/accounts/:id/transactions — auth check", () => {
  it("returns 401 without authentication", async () => {
    const res = await request(app).get(`/fdx/accounts/${randomUUID()}/transactions`);
    expect(res.status).toBe(401);
  });
});

describe("GET /fdx/customers/current — auth check", () => {
  it("returns 401 without authentication", async () => {
    const res = await request(app).get("/fdx/customers/current");
    expect(res.status).toBe(401);
  });
});

describe.skipIf(!hasDb)("GET /fdx/accounts — authenticated", () => {
  it("returns empty accounts array for new user", async () => {
    const { cookie } = await authenticate();
    const res = await request(app).get("/fdx/accounts").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.accounts)).toBe(true);
  }, 20_000);

  it("returns FDX-formatted accounts", async () => {
    const { cookie, userId } = await authenticate();
    await seedAccount(userId);
    const res = await request(app).get("/fdx/accounts").set("Cookie", cookie);
    expect(res.status).toBe(200);
    const acct = res.body.accounts[0];
    expect(acct.accountId).toBeDefined();
    expect(acct.displayName).toBe("FDX Test Bank");
    expect(acct.accountType).toBe("CHECKING");
    expect(acct.currency.currencyCode).toBe("CAD");
    expect(typeof acct.currentBalance).toBe("number");
    expect(acct.currentBalance).toBe(5000); // 500000 cents → 5000 dollars
    expect(acct.status).toBe("OPEN");
  }, 20_000);

  it("only returns accounts belonging to the authenticated user", async () => {
    const user1 = await authenticate();
    const user2 = await authenticate();
    await seedAccount(user2.userId);

    const res = await request(app).get("/fdx/accounts").set("Cookie", user1.cookie);
    expect(res.status).toBe(200);
    // user1 has no accounts seeded
    const ids = res.body.accounts.map((a: { accountId: string }) => a.accountId);
    expect(ids.length).toBe(0);
  }, 20_000);
});

describe.skipIf(!hasDb)("GET /fdx/accounts/:id/transactions — authenticated", () => {
  it("returns FDX-formatted transactions", async () => {
    const { cookie, userId } = await authenticate();
    const account = await seedAccount(userId);
    await seedTransaction(userId, account.id);

    const res = await request(app)
      .get(`/fdx/accounts/${account.id}/transactions`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.transactions)).toBe(true);
    expect(res.body.transactions.length).toBeGreaterThanOrEqual(1);

    const tx = res.body.transactions[0];
    expect(tx.transactionId).toBeDefined();
    expect(tx.accountId).toBe(account.id);
    expect(tx.amount).toBe(25); // 2500 cents → 25 dollars
    expect(tx.transactionType).toBe("DEBIT");
    expect(tx.status).toBe("POSTED");
    expect(tx.merchantName).toBe("FDX Store");
  }, 20_000);

  it("returns empty list for account with no transactions", async () => {
    const { cookie, userId } = await authenticate();
    const account = await seedAccount(userId);
    const res = await request(app)
      .get(`/fdx/accounts/${account.id}/transactions`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.transactions).toHaveLength(0);
    expect(res.body.nextCursor).toBeNull();
  }, 20_000);
});

describe.skipIf(!hasDb)("GET /fdx/customers/current — authenticated", () => {
  it("returns FDX customer with customerId and email", async () => {
    const { cookie } = await authenticate();
    const res = await request(app).get("/fdx/customers/current").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.customerId).toBeDefined();
    expect(typeof res.body.email).toBe("string");
    expect(res.body.email).toContain("@");
  }, 20_000);
});
