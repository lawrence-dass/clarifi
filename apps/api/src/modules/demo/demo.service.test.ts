import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  AccountType,
  CanonicalAccount,
  CanonicalTransaction,
  Provider,
  prisma,
  withUserContext,
} from "@clarifi/shared";

// Avoid Redis: stub the categorize enqueue (same seam ingestion.routes.test uses).
// Doubles as the AC4 assertion surface — categorization is requested, never an
// inline LLM call.
const mocks = vi.hoisted(() => ({ requestCategorization: vi.fn(async () => undefined) }));
vi.mock("../../queues/categorize.outbox.js", () => ({
  requestCategorization: mocks.requestCategorization,
}));

import { provisionDemoUser } from "./demo.service.js";
import { DEMO_SEED_CSV } from "./seed-data/demo-statement.js";
import { importCsv } from "../ingestion/ingestion.service.js";
import { loginUser } from "../auth/auth.service.js";
import { setPlaidAdapterForTests } from "../accounts/accounts.service.js";
import type { PlaidAdapter } from "../../lib/plaid-adapter.js";

const dbUrl = process.env.DATABASE_URL ?? "";
const hasDb = dbUrl.length > 0 && !dbUrl.includes("placeholder");

// The institution name provisionDemoUser passes to importCsv (kept in sync).
const DEMO_INSTITUTION = "Clarifi Demo Bank";

const createdUserIds: string[] = [];
function track<T extends { id: string }>(user: T): T {
  createdUserIds.push(user.id);
  return user;
}

afterAll(async () => {
  if (createdUserIds.length) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

let restorePlaid: (() => void) | undefined;
afterEach(() => {
  restorePlaid?.();
  restorePlaid = undefined;
  mocks.requestCategorization.mockClear();
});

/**
 * A fake Plaid adapter that drives the real seed pipeline without a network call.
 * providerAccountId/providerTransactionId are derived from the (random) access
 * token so two demo users never collide on the global (provider, providerAccountId)
 * unique key — mirroring real Sandbox, which hands out unique account ids.
 */
function makeFakeAdapter(overrides: Partial<PlaidAdapter> = {}): PlaidAdapter {
  return {
    createLinkToken: async () => "link-token",
    createSandboxPublicToken: async () => "public-sandbox-token",
    exchangePublicToken: async () => ({ accessToken: `acc-${randomUUID()}`, itemId: `item-${randomUUID()}` }),
    getItemAccounts: async (accessToken: string) => ({
      institutionName: "Sandbox Demo Bank",
      accounts: [
        CanonicalAccount.parse({
          provider: Provider.plaid,
          providerAccountId: `sbacct-${accessToken}`,
          institutionName: "Sandbox Demo Bank",
          accountType: AccountType.checking,
          balanceCents: 50000n,
          currency: "CAD",
          mask: "0000",
        }),
      ],
    }),
    syncTransactions: async (accessToken: string, cursor?: string) => {
      if (cursor) {
        return { added: [], modified: [], removedProviderTransactionIds: [], nextCursor: cursor, hasMore: false };
      }
      return {
        added: [
          CanonicalTransaction.parse({
            providerTransactionId: `sbtxn-${accessToken}`,
            providerAccountId: `sbacct-${accessToken}`,
            date: new Date("2026-06-10T00:00:00.000Z"),
            amountCents: -4200n,
            currency: "CAD",
            rawDescription: "SANDBOX COFFEE",
            merchantName: "Sandbox Coffee",
            pending: false,
            pendingTransactionId: null,
          }),
        ],
        modified: [],
        removedProviderTransactionIds: [],
        nextCursor: "cursor-1",
        hasMore: false,
      };
    },
    getWebhookVerificationKey: async () => ({}),
    ...overrides,
  };
}

async function provisionWithFake(): ReturnType<typeof provisionDemoUser> {
  const fake = makeFakeAdapter();
  restorePlaid = setPlaidAdapterForTests(fake);
  return provisionDemoUser({ plaidAdapter: fake });
}

describe.skipIf(!hasDb)("provisionDemoUser (Story 12.1)", () => {
  it("creates an isDemo user with a 1h TTL, a synthetic email, and an unusable password (AC2, AC5)", async () => {
    const before = Date.now();
    const demo = track(await provisionWithFake());
    const after = Date.now();

    expect(demo.isDemo).toBe(true);
    expect(demo.email).toMatch(/^demo\+[0-9a-f-]{36}@demo\.clarifi\.local$/);

    const row = await prisma.user.findUnique({
      where: { id: demo.id },
      select: { isDemo: true, demoExpiresAt: true, passwordHash: true },
    });
    expect(row?.isDemo).toBe(true);
    expect(row?.passwordHash).toBeTruthy();
    const expiry = row?.demoExpiresAt?.getTime() ?? 0;
    expect(expiry).toBeGreaterThanOrEqual(before + 60 * 60 * 1000 - 1000);
    expect(expiry).toBeLessThanOrEqual(after + 60 * 60 * 1000 + 1000);
  });

  it("seeds through BOTH canonical adapters and requests categorization, never an inline LLM call (AC3, AC4)", async () => {
    const demo = track(await provisionWithFake());
    expect(demo.plaidSeeded).toBe(true);

    const accounts = await withUserContext(demo.id, (tx) =>
      tx.account.findMany({ select: { provider: true } }),
    );
    const providers = accounts.map((a) => a.provider).sort();
    expect(providers).toContain(Provider.csv);
    expect(providers).toContain(Provider.plaid);

    // AC4: categorization was enqueued (CSV import + per Plaid account), not run inline.
    expect(mocks.requestCategorization).toHaveBeenCalled();
  });

  it("stores seeded money as integer cents, signed from the user's perspective (AC3, AC6)", async () => {
    const demo = track(await provisionWithFake());

    const payroll = await withUserContext(demo.id, (tx) =>
      tx.transaction.findFirst({
        where: { rawDescription: "Payroll Deposit - ACME Corp" },
        select: { amountCents: true },
      }),
    );
    const loblaws = await withUserContext(demo.id, (tx) =>
      tx.transaction.findFirst({
        where: { rawDescription: "Loblaws" },
        orderBy: { date: "asc" },
        select: { amountCents: true },
      }),
    );
    expect(payroll?.amountCents).toBe(245000n); // +$2450.00 inflow
    expect(loblaws?.amountCents).toBe(-9240n); //  -$92.40 outflow
  });

  it("isolates demo users from each other under RLS (AC2)", async () => {
    const a = track(await provisionWithFake());
    const b = track(await provisionWithFake());

    const aTxns = await withUserContext(a.id, (tx) =>
      tx.transaction.findMany({ select: { userId: true } }),
    );
    expect(aTxns.length).toBeGreaterThan(0);
    expect(aTxns.every((t) => t.userId === a.id)).toBe(true);

    // Under A's context, B's rows are invisible — even by explicit userId filter.
    const aSeesB = await withUserContext(a.id, (tx) =>
      tx.transaction.count({ where: { userId: b.id } }),
    );
    expect(aSeesB).toBe(0);
  });

  it("does not let a demo user sign in with a password (AC2/AC5)", async () => {
    const demo = track(await provisionWithFake());
    await expect(loginUser({ email: demo.email, password: "anything-at-all" })).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
  });

  it("re-importing the same seed statement is idempotent — no duplicate rows (AC6)", async () => {
    const demo = track(await provisionWithFake());
    const again = await importCsv({
      userId: demo.id,
      bankFormat: "generic",
      institution: DEMO_INSTITUTION,
      csv: DEMO_SEED_CSV,
    });
    expect(again.imported).toBe(0);
    expect(again.duplicatesSkipped).toBeGreaterThan(0);
  });

  it("falls back to CSV-only when the Plaid Sandbox seed fails (degradation, no 500)", async () => {
    const fake = makeFakeAdapter({
      createSandboxPublicToken: async () => {
        throw new Error("plaid sandbox unavailable");
      },
    });
    restorePlaid = setPlaidAdapterForTests(fake);
    const demo = track(await provisionDemoUser({ plaidAdapter: fake }));

    expect(demo.plaidSeeded).toBe(false);
    const csvAccounts = await withUserContext(demo.id, (tx) =>
      tx.account.count({ where: { provider: Provider.csv } }),
    );
    const plaidAccounts = await withUserContext(demo.id, (tx) =>
      tx.account.count({ where: { provider: Provider.plaid } }),
    );
    expect(csvAccounts).toBe(1);
    expect(plaidAccounts).toBe(0);
  });
});
