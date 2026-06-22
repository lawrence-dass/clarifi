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

// Story 12.4: provisioning categorizes INLINE via the worker's processCategorizeJob
// (no real LLM in tests). Stub it; assert it runs per account instead of the
// async enqueue (which is now suppressed).
const workerMocks = vi.hoisted(() => ({ processCategorizeJob: vi.fn(async () => undefined) }));
vi.mock("../../workers/categorize.worker.js", () => ({
  processCategorizeJob: workerMocks.processCategorizeJob,
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
  workerMocks.processCategorizeJob.mockClear();
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

// CSV demo touches no Plaid path, so no adapter wiring is needed.
function provisionCsv(): ReturnType<typeof provisionDemoUser> {
  return provisionDemoUser({ kind: "csv" });
}
// Plaid demo: inject the fake into BOTH seams (provision option + the accounts
// module global used by the reused exchangePlaidPublicToken).
function provisionPlaid(adapter = makeFakeAdapter()): ReturnType<typeof provisionDemoUser> {
  restorePlaid = setPlaidAdapterForTests(adapter);
  return provisionDemoUser({ kind: "plaid", plaidAdapter: adapter });
}

describe.skipIf(!hasDb)("provisionDemoUser (Story 12.3 — kind-branched)", () => {
  it("creates an isDemo user with a 1h TTL, synthetic email, unusable password, and demoKind (AC2)", async () => {
    const before = Date.now();
    const demo = track(await provisionCsv());
    const after = Date.now();

    expect(demo.isDemo).toBe(true);
    expect(demo.demoKind).toBe("csv");
    expect(demo.email).toMatch(/^demo\+[0-9a-f-]{36}@demo\.clarifi\.local$/);

    const row = await prisma.user.findUnique({
      where: { id: demo.id },
      select: { isDemo: true, demoExpiresAt: true, passwordHash: true, demoKind: true },
    });
    expect(row?.isDemo).toBe(true);
    expect(row?.demoKind).toBe("csv");
    expect(row?.passwordHash).toBeTruthy();
    const expiry = row?.demoExpiresAt?.getTime() ?? 0;
    expect(expiry).toBeGreaterThanOrEqual(before + 60 * 60 * 1000 - 1000);
    expect(expiry).toBeLessThanOrEqual(after + 60 * 60 * 1000 + 1000);
  });

  it("CSV demo seeds ONLY CSV (no Plaid) and categorizes inline, not via the async queue (AC3, AC4, 12.4)", async () => {
    const demo = track(await provisionCsv());

    const csv = await withUserContext(demo.id, (tx) =>
      tx.account.count({ where: { provider: Provider.csv } }),
    );
    const plaid = await withUserContext(demo.id, (tx) =>
      tx.account.count({ where: { provider: Provider.plaid } }),
    );
    expect(csv).toBe(1);
    expect(plaid).toBe(0);
    // 12.4: categorization runs INLINE (per account) before the mint returns,
    // and the async enqueue is suppressed (so the worker can't double-detect).
    expect(workerMocks.processCategorizeJob).toHaveBeenCalled();
    expect(mocks.requestCategorization).not.toHaveBeenCalled();
  });

  it("Plaid demo seeds ONLY Plaid (no CSV) with demoKind=plaid (AC3)", async () => {
    const demo = track(await provisionPlaid());
    expect(demo.demoKind).toBe("plaid");

    const csv = await withUserContext(demo.id, (tx) =>
      tx.account.count({ where: { provider: Provider.csv } }),
    );
    const plaid = await withUserContext(demo.id, (tx) =>
      tx.account.count({ where: { provider: Provider.plaid } }),
    );
    expect(plaid).toBeGreaterThan(0);
    expect(csv).toBe(0);
  });

  it("CSV demo stores money as integer cents, signed from the user's perspective (AC3)", async () => {
    const demo = track(await provisionCsv());

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

  it("isolates demo users from each other under RLS (AC3)", async () => {
    const a = track(await provisionCsv());
    const b = track(await provisionCsv());

    const aTxns = await withUserContext(a.id, (tx) =>
      tx.transaction.findMany({ select: { userId: true } }),
    );
    expect(aTxns.length).toBeGreaterThan(0);
    expect(aTxns.every((t) => t.userId === a.id)).toBe(true);

    const aSeesB = await withUserContext(a.id, (tx) =>
      tx.transaction.count({ where: { userId: b.id } }),
    );
    expect(aSeesB).toBe(0);
  });

  it("does not let a demo user sign in with a password", async () => {
    const demo = track(await provisionCsv());
    await expect(loginUser({ email: demo.email, password: "anything-at-all" })).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
  });

  it("re-importing the same seed statement is idempotent — no duplicate rows", async () => {
    const demo = track(await provisionCsv());
    const again = await importCsv({
      userId: demo.id,
      bankFormat: "generic",
      institution: DEMO_INSTITUTION,
      csv: DEMO_SEED_CSV,
    });
    expect(again.imported).toBe(0);
    expect(again.duplicatesSkipped).toBeGreaterThan(0);
  });

  it("Plaid demo returns 503 (no CSV fallback, no orphan user) when the Plaid seed fails", async () => {
    const fake = makeFakeAdapter({
      createSandboxPublicToken: async () => {
        throw new Error("plaid sandbox unavailable");
      },
    });
    restorePlaid = setPlaidAdapterForTests(fake);

    const demosBefore = await prisma.user.count({ where: { isDemo: true, demoKind: "plaid" } });
    await expect(provisionDemoUser({ kind: "plaid", plaidAdapter: fake })).rejects.toMatchObject({
      code: "PLAID_DEMO_UNAVAILABLE",
      httpStatus: 503,
    });
    // The just-created empty user was deleted before throwing — no orphan.
    const demosAfter = await prisma.user.count({ where: { isDemo: true, demoKind: "plaid" } });
    expect(demosAfter).toBe(demosBefore);
  });
});
