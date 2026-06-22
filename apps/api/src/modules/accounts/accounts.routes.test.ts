import { afterAll, afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { AccountType, prisma, Provider, withUserContext } from "@clarifi/shared";
import { createApp } from "../../app.js";
import { decryptSecret } from "../../lib/crypto.js";
import { setPlaidAdapterForTests } from "./accounts.service.js";
import type { PlaidAdapter } from "../../lib/plaid-adapter.js";

const dbUrl = process.env.DATABASE_URL ?? "";
const hasDb = dbUrl.length > 0 && !dbUrl.includes("placeholder");
const app = createApp();
const emails: string[] = [];
let restorePlaidAdapter: (() => void) | undefined;

afterEach(() => {
  restorePlaidAdapter?.();
  restorePlaidAdapter = undefined;
});

afterAll(async () => {
  if (emails.length) await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.$disconnect();
});

async function authenticate(): Promise<{ cookie: string; userId: string }> {
  const email = `accounts-${randomUUID()}@example.test`;
  emails.push(email);
  const password = "correct-horse-battery";
  await request(app).post("/auth/register").send({ email, password, consent: true });
  const login = await request(app).post("/auth/login").send({ email, password });
  const set = login.headers["set-cookie"];
  const cookies = Array.isArray(set) ? set : set ? [set] : [];
  return { cookie: cookies.map((cookie) => cookie.split(";")[0]).join("; "), userId: login.body.id };
}

function installAdapter(adapter: PlaidAdapter): void {
  restorePlaidAdapter = setPlaidAdapterForTests(adapter);
}

function fakeAdapter(input?: {
  accessToken?: string;
  itemId?: string;
  accountPrefix?: string;
  balanceCents?: bigint;
  throwWithToken?: string;
}): PlaidAdapter {
  const accessToken = input?.accessToken ?? "access-sandbox-secret-token";
  const itemId = input?.itemId ?? "item-sandbox-1";
  const accountPrefix = input?.accountPrefix ?? itemId;
  return {
    async createLinkToken() {
      if (input?.throwWithToken) throw new Error(`provider leaked ${input.throwWithToken}`);
      return "link-sandbox-token";
    },
    async createSandboxPublicToken() {
      return "public-sandbox-token";
    },
    async exchangePublicToken() {
      if (input?.throwWithToken) throw new Error(`provider leaked ${input.throwWithToken}`);
      return { accessToken, itemId };
    },
    async getItemAccounts() {
      return {
        institutionName: "Route Test Bank",
        accounts: [
          {
            provider: Provider.plaid,
            providerAccountId: `${accountPrefix}-checking`,
            institutionName: "Route Test Bank",
            accountType: AccountType.checking,
            balanceCents: input?.balanceCents ?? 12345n,
            currency: "CAD",
            mask: "0000",
          },
          {
            provider: Provider.plaid,
            providerAccountId: `${accountPrefix}-card`,
            institutionName: "Route Test Bank",
            accountType: AccountType.credit_card,
            balanceCents: 4201n,
            currency: "USD",
            mask: "1111",
          },
        ],
      };
    },
    async syncTransactions() {
      throw new Error("not used");
    },
    async getWebhookVerificationKey() {
      throw new Error("not used");
    },
  };
}

describe.skipIf(!hasDb)("POST /accounts/plaid/link-token", () => {
  it("requires authentication", async () => {
    installAdapter(fakeAdapter());
    const res = await request(app).post("/accounts/plaid/link-token").send({});
    expect(res.status).toBe(401);
  });

  it("returns only a link token for an authenticated user", async () => {
    installAdapter(fakeAdapter());
    const auth = await authenticate();

    const res = await request(app).post("/accounts/plaid/link-token").set("Cookie", auth.cookie).send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ linkToken: "link-sandbox-token" });
    expect(JSON.stringify(res.body)).not.toContain("access-sandbox-secret-token");
  });
});

describe.skipIf(!hasDb)("POST /accounts/plaid/exchange", () => {
  it("requires authentication and validates the request body", async () => {
    installAdapter(fakeAdapter());
    const unauthenticated = await request(app)
      .post("/accounts/plaid/exchange")
      .send({ publicToken: "public-sandbox-token" });
    expect(unauthenticated.status).toBe(401);

    const auth = await authenticate();
    const invalid = await request(app).post("/accounts/plaid/exchange").set("Cookie", auth.cookie).send({});
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("INVALID_PLAID_EXCHANGE");
  });

  it("creates encrypted PlaidItem and safe account responses without token leakage", async () => {
    const accessToken = "access-sandbox-secret-token";
    const publicToken = "public-sandbox-token";
    installAdapter(fakeAdapter({ accessToken, itemId: `item-${randomUUID()}`, accountPrefix: `acct-${randomUUID()}` }));
    const auth = await authenticate();

    const res = await request(app)
      .post("/accounts/plaid/exchange")
      .set("Cookie", auth.cookie)
      .send({ publicToken });

    expect(res.status).toBe(200);
    expect(res.body.accounts).toEqual([
      {
        id: expect.any(String),
        institutionName: "Route Test Bank",
        accountType: AccountType.checking,
        currency: "CAD",
        mask: "0000",
      },
      {
        id: expect.any(String),
        institutionName: "Route Test Bank",
        accountType: AccountType.credit_card,
        currency: "USD",
        mask: "1111",
      },
    ]);
    expect(JSON.stringify(res.body)).not.toContain(accessToken);
    expect(JSON.stringify(res.body)).not.toContain(publicToken);

    const plaidItems = await withUserContext(auth.userId, (tx) => tx.plaidItem.findMany());
    expect(plaidItems).toHaveLength(1);
    expect(plaidItems[0]?.accessTokenEncrypted).not.toBe(accessToken);
    expect(plaidItems[0]?.accessTokenEncrypted).not.toContain(accessToken);
    expect(decryptSecret(plaidItems[0]!.accessTokenEncrypted)).toBe(accessToken);

    const accounts = await withUserContext(auth.userId, (tx) =>
      tx.account.findMany({
        where: { provider: Provider.plaid },
        orderBy: { providerAccountId: "asc" },
      }),
    );
    expect(accounts).toHaveLength(2);
    expect(accounts.map((account) => account.currency).sort()).toEqual(["CAD", "USD"]);
    expect(accounts.every((account) => account.plaidItemId === plaidItems[0]!.id)).toBe(true);
  }, 20_000);

  it("is idempotent for the same item and account ids", async () => {
    const itemId = `item-${randomUUID()}`;
    const accountPrefix = `acct-${randomUUID()}`;
    installAdapter(fakeAdapter({ accessToken: "access-token-v1", itemId, accountPrefix, balanceCents: 10000n }));
    const auth = await authenticate();

    const first = await request(app)
      .post("/accounts/plaid/exchange")
      .set("Cookie", auth.cookie)
      .send({ publicToken: "public-token-1" });
    expect(first.status).toBe(200);

    restorePlaidAdapter?.();
    installAdapter(fakeAdapter({ accessToken: "access-token-v2", itemId, accountPrefix, balanceCents: 99999n }));
    const second = await request(app)
      .post("/accounts/plaid/exchange")
      .set("Cookie", auth.cookie)
      .send({ publicToken: "public-token-2" });
    expect(second.status).toBe(200);

    const rows = await withUserContext(auth.userId, async (tx) => ({
      plaidItems: await tx.plaidItem.findMany({ where: { itemId } }),
      accounts: await tx.account.findMany({ where: { provider: Provider.plaid } }),
    }));

    expect(rows.plaidItems).toHaveLength(1);
    expect(rows.accounts).toHaveLength(2);
    expect(decryptSecret(rows.plaidItems[0]!.accessTokenEncrypted)).toBe("access-token-v2");
    expect(rows.accounts.find((account) => account.providerAccountId === `${accountPrefix}-checking`)?.balanceCents).toBe(
      99999n,
    );
  }, 20_000);

  it("does not expose provider exception text that contains a token", async () => {
    const leakedToken = "public-sandbox-token-never-return";
    installAdapter(fakeAdapter({ throwWithToken: leakedToken }));
    const auth = await authenticate();

    const res = await request(app)
      .post("/accounts/plaid/exchange")
      .set("Cookie", auth.cookie)
      .send({ publicToken: leakedToken });

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("PLAID_EXCHANGE_FAILED");
    expect(JSON.stringify(res.body)).not.toContain(leakedToken);
  }, 20_000);

  it("enforces tenant isolation on PlaidItems under RLS", async () => {
    installAdapter(fakeAdapter({ itemId: `item-${randomUUID()}`, accountPrefix: `acct-${randomUUID()}` }));
    const owner = await authenticate();
    const other = await authenticate();

    const res = await request(app)
      .post("/accounts/plaid/exchange")
      .set("Cookie", owner.cookie)
      .send({ publicToken: "public-token-owner" });
    expect(res.status).toBe(200);

    const ownerItems = await withUserContext(owner.userId, (tx) => tx.plaidItem.findMany());
    const otherItems = await withUserContext(other.userId, (tx) => tx.plaidItem.findMany());
    expect(ownerItems).toHaveLength(1);
    expect(otherItems).toHaveLength(0);
  }, 20_000);
});
