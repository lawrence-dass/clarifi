import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma, withUserContext } from "./prisma.js";
import {
  Provider,
  AccountType,
  TransactionDirection,
} from "./generated/prisma/client.js";

// This suite proves database-enforced multi-tenancy (Postgres RLS). It needs a
// live database; skip when DATABASE_URL is unset or still the placeholder so CI
// without a DB stays green.
const dbUrl = process.env.DATABASE_URL ?? "";
const hasDb = dbUrl.length > 0 && !dbUrl.includes("placeholder");

const userAId = randomUUID();
const userBId = randomUUID();
const acctAId = randomUUID();
const acctBId = randomUUID();

describe.skipIf(!hasDb)("RLS tenant isolation", () => {
  beforeAll(async () => {
    // Seed each user's data UNDER THAT USER'S CONTEXT (FORCE RLS checks INSERTs too).
    await withUserContext(userAId, (tx) =>
      tx.user.create({
        data: {
          id: userAId,
          email: `a-${userAId}@example.test`,
          passwordHash: "x",
          consentedAt: new Date(),
        },
      }),
    );
    await withUserContext(userBId, (tx) =>
      tx.user.create({
        data: {
          id: userBId,
          email: `b-${userBId}@example.test`,
          passwordHash: "x",
          consentedAt: new Date(),
        },
      }),
    );

    await withUserContext(userAId, (tx) =>
      tx.account.create({
        data: {
          id: acctAId,
          userId: userAId,
          provider: Provider.csv,
          providerAccountId: `pa-${acctAId}`,
          institutionName: "TD",
          accountType: AccountType.checking,
          balanceCents: 0n,
          currency: "CAD",
        },
      }),
    );
    await withUserContext(userBId, (tx) =>
      tx.account.create({
        data: {
          id: acctBId,
          userId: userBId,
          provider: Provider.csv,
          providerAccountId: `pa-${acctBId}`,
          institutionName: "RBC",
          accountType: AccountType.checking,
          balanceCents: 0n,
          currency: "CAD",
        },
      }),
    );

    await withUserContext(userAId, (tx) =>
      tx.transaction.create({
        data: {
          accountId: acctAId,
          userId: userAId,
          provider: Provider.csv,
          providerTransactionId: `t-${randomUUID()}`,
          date: new Date(),
          amountCents: -1000n,
          direction: TransactionDirection.debit,
          currency: "CAD",
          rawDescription: "A: coffee",
        },
      }),
    );
    await withUserContext(userBId, (tx) =>
      tx.transaction.create({
        data: {
          accountId: acctBId,
          userId: userBId,
          provider: Provider.csv,
          providerTransactionId: `t-${randomUUID()}`,
          date: new Date(),
          amountCents: -2000n,
          direction: TransactionDirection.debit,
          currency: "CAD",
          rawDescription: "B: groceries",
        },
      }),
    );
  });

  afterAll(async () => {
    // Clean up each user's rows under their own context (cascade handles children).
    await withUserContext(userAId, async (tx) => {
      await tx.transaction.deleteMany();
      await tx.account.deleteMany();
      await tx.user.deleteMany();
    });
    await withUserContext(userBId, async (tx) => {
      await tx.transaction.deleteMany();
      await tx.account.deleteMany();
      await tx.user.deleteMany();
    });
    await prisma.$disconnect();
  });

  it("returns only the requesting user's rows even with NO where clause (AC #3)", async () => {
    const rows = await withUserContext(userAId, (tx) =>
      tx.transaction.findMany(),
    );
    expect(rows.length).toBe(1);
    expect(rows.every((r) => r.userId === userAId)).toBe(true);
  });

  it("never leaks another user's rows", async () => {
    const rows = await withUserContext(userAId, (tx) =>
      tx.transaction.findMany(),
    );
    expect(rows.some((r) => r.userId === userBId)).toBe(false);
  });

  it("blocks writing a row owned by another user via WITH CHECK (AC #4)", async () => {
    await expect(
      withUserContext(userAId, (tx) =>
        tx.transaction.create({
          data: {
            accountId: acctAId,
            userId: userBId, // hostile: trying to write as userB while acting as userA
            provider: Provider.csv,
            providerTransactionId: `evil-${randomUUID()}`,
            date: new Date(),
            amountCents: -9999n,
            direction: TransactionDirection.debit,
            currency: "CAD",
            rawDescription: "cross-tenant write attempt",
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("shows an unrelated user zero rows (deny-by-default)", async () => {
    const strangerId = randomUUID();
    const rows = await withUserContext(strangerId, (tx) =>
      tx.transaction.findMany(),
    );
    expect(rows.length).toBe(0);
  });

  // Mechanism checks: prove that the SET LOCAL ROLE → RLS-subject role is what
  // enforces isolation, not coincidence. Without these, the suite could stay
  // green while production (connecting as a BYPASSRLS role) silently skips RLS
  // if the role switch ever fails or regresses.
  it("runs queries as the RLS-subject role clarifi_app inside withUserContext", async () => {
    const rows = await withUserContext(userAId, (tx) =>
      tx.$queryRaw<{ role: string }[]>`SELECT current_user::text AS role`,
    );
    expect(rows[0]?.role).toBe("clarifi_app");
  });

  it("base connection role (no withUserContext) would see every tenant's rows — RLS, not luck, isolates", async () => {
    // The pooled DATABASE_URL connects as the admin role (BYPASSRLS on Supabase).
    // Outside withUserContext there is no role switch and no GUC, so this query
    // sees both userA's and userB's seeded transactions. This is exactly why all
    // user-data access MUST go through withUserContext.
    const rows = await prisma.transaction.findMany();
    expect(rows.some((r) => r.userId === userAId)).toBe(true);
    expect(rows.some((r) => r.userId === userBId)).toBe(true);
  });
});
