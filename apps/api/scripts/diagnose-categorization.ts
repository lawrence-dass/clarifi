// One-off read-only diagnostic: where did categorization get stuck?
// Run: set -a && source .env && set +a && pnpm --filter @clarifi/api exec tsx scripts/diagnose-categorization.ts
import { prisma } from "@clarifi/shared";

async function main() {
  const [total, uncategorized, withMerchant, outboxPending, outboxProcessed, anomalies] =
    await Promise.all([
      prisma.transaction.count(),
      prisma.transaction.count({ where: { category: null } }),
      prisma.transaction.count({ where: { merchantName: { not: null } } }),
      prisma.outbox.count({ where: { eventType: "categorization.requested", processed: false } }),
      prisma.outbox.count({ where: { eventType: "categorization.requested", processed: true } }),
      prisma.anomaly.count(),
    ]);

  // Accounts that still have uncategorized transactions (what we'd re-trigger).
  const stuckAccounts = await prisma.transaction.groupBy({
    by: ["accountId"],
    where: { category: null, status: { not: "removed" } },
    _count: { _all: true },
  });

  console.log(
    JSON.stringify(
      { total, uncategorized, withMerchant, outboxPending, outboxProcessed, anomalies, stuckAccounts },
      null,
      2,
    ),
  );
  await prisma.$disconnect();
}

void main();
