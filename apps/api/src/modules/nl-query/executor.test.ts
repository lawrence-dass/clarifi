import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  AccountType,
  Provider,
  TransactionDirection,
  TransactionStatus,
  prisma,
  withReadOnlyUserContext,
} from "@clarifi/shared";
import type { QueryIR } from "@clarifi/shared";
import { executeQueryIR } from "./executor.js";

const dbUrl = process.env.DATABASE_URL ?? "";
const hasDb = dbUrl.length > 0 && !dbUrl.includes("placeholder");
const userIds: string[] = [];

async function seedUserWithSpend(spendCents: bigint[]): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `nl-exec-${randomUUID()}@example.test`,
      passwordHash: "hashed-password",
      consentedAt: new Date("2026-06-01T00:00:00.000Z"),
    },
  });
  userIds.push(user.id);
  const account = await prisma.account.create({
    data: {
      userId: user.id,
      provider: Provider.csv,
      providerAccountId: `acct-${randomUUID()}`,
      institutionName: "Exec Test Bank",
      accountType: AccountType.checking,
      balanceCents: 0n,
      currency: "CAD",
    },
  });
  for (const cents of spendCents) {
    await prisma.transaction.create({
      data: {
        userId: user.id,
        accountId: account.id,
        provider: Provider.csv,
        providerTransactionId: `txn-${randomUUID()}`,
        date: new Date("2026-06-15T12:00:00.000Z"),
        amountCents: cents,
        direction: cents < 0n ? TransactionDirection.debit : TransactionDirection.credit,
        currency: "CAD",
        rawDescription: "EXEC TEST",
        status: TransactionStatus.posted,
      },
    });
  }
  return user.id;
}

const SPEND_IR: QueryIR = {
  metric: "total_spend",
  dimensions: [],
  filters: [],
  timeRange: { start: "2026-06-01", end: "2026-06-30" },
  limit: 1,
  interpretation: "Total spend in June 2026.",
};

afterAll(async () => {
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe.skipIf(!hasDb)("executeQueryIR (read-only role + RLS)", () => {
  it("returns only the calling user's rows (RLS holds under the read-only role)", async () => {
    const userA = await seedUserWithSpend([-10_000n, -5_000n, 20_000n]); // spend -15000
    await seedUserWithSpend([-99_999n]); // userB — must not leak into A's result

    const result = await executeQueryIR(SPEND_IR, userA);
    expect(result.rows).toHaveLength(1);
    expect(Number(result.rows[0]!.value)).toBe(-15_000);
    expect(result.interpretation).toBe(SPEND_IR.interpretation);
  });

  it("rejects a write attempted on the read-only context (defense in depth)", async () => {
    const userId = await seedUserWithSpend([-1_000n]);
    await expect(
      withReadOnlyUserContext(userId, (tx) =>
        tx.$executeRawUnsafe(
          "UPDATE transactions SET merchant_name = 'hacked' WHERE user_id = $1",
          userId,
        ),
      ),
    ).rejects.toThrow();

    // The row is unchanged.
    const rows = await prisma.transaction.findMany({ where: { userId } });
    expect(rows.every((r) => r.merchantName !== "hacked")).toBe(true);
  });
});
