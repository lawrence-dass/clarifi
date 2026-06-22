import { afterAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  prisma,
  AccountType,
  Provider,
  TransactionDirection,
} from "@clarifi/shared";

// Keep the reaper hermetic to the DB — its best-effort Redis cleanup is not under test here.
vi.mock("../modules/demo/demo-quota.js", () => ({ clearDemoQuota: vi.fn(async () => undefined) }));

import { reapExpiredDemoUsers } from "./demo-reaper.js";

const dbUrl = process.env.DATABASE_URL ?? "";
const hasDb = dbUrl.length > 0 && !dbUrl.includes("placeholder");

const createdUserIds: string[] = [];

async function makeUser(opts: { isDemo: boolean; expiresAt: Date | null }): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `reaper-${randomUUID()}@example.test`,
      passwordHash: "x".repeat(40),
      consentedAt: new Date(),
      isDemo: opts.isDemo,
      demoExpiresAt: opts.expiresAt,
    },
    select: { id: true },
  });
  createdUserIds.push(user.id);
  return user.id;
}

async function seedAccountAndTxn(userId: string): Promise<{ accountId: string; txnId: string }> {
  const account = await prisma.account.create({
    data: {
      userId,
      provider: Provider.csv,
      providerAccountId: `acct-${randomUUID()}`,
      institutionName: "Reaper Test Bank",
      accountType: AccountType.checking,
      balanceCents: 0n,
      currency: "CAD",
    },
    select: { id: true },
  });
  const txn = await prisma.transaction.create({
    data: {
      accountId: account.id,
      userId,
      provider: Provider.csv,
      providerTransactionId: `txn-${randomUUID()}`,
      date: new Date("2026-06-01T00:00:00.000Z"),
      amountCents: -1234n,
      direction: TransactionDirection.debit,
      currency: "CAD",
      rawDescription: "DEMO SEED",
    },
    select: { id: true },
  });
  return { accountId: account.id, txnId: txn.id };
}

afterAll(async () => {
  if (createdUserIds.length) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

describe.skipIf(!hasDb)("reapExpiredDemoUsers (Story 12.2)", () => {
  it("deletes expired demo users end-to-end (cascade) and leaves others intact", async () => {
    const hourAgo = new Date(Date.now() - 60 * 60_000);
    const hourAhead = new Date(Date.now() + 60 * 60_000);

    const expiredDemo = await makeUser({ isDemo: true, expiresAt: hourAgo });
    const expiredChildren = await seedAccountAndTxn(expiredDemo);
    const liveDemo = await makeUser({ isDemo: true, expiresAt: hourAhead });
    const realUser = await makeUser({ isDemo: false, expiresAt: null });

    const deleted = await reapExpiredDemoUsers({ batch: 100 });
    expect(deleted).toBeGreaterThanOrEqual(1);

    // Expired demo user + its data are gone (PIPEDA deletion via cascade).
    expect(await prisma.user.findUnique({ where: { id: expiredDemo } })).toBeNull();
    expect(await prisma.account.findUnique({ where: { id: expiredChildren.accountId } })).toBeNull();
    expect(await prisma.transaction.findUnique({ where: { id: expiredChildren.txnId } })).toBeNull();

    // A not-yet-expired demo user and a real user are untouched.
    expect(await prisma.user.findUnique({ where: { id: liveDemo } })).not.toBeNull();
    expect(await prisma.user.findUnique({ where: { id: realUser } })).not.toBeNull();
  });

  it("is a no-op when there is nothing to reap", async () => {
    // Second sweep: the only expired demo user is already gone.
    const deleted = await reapExpiredDemoUsers({ batch: 100 });
    expect(deleted).toBe(0);
  });
});
