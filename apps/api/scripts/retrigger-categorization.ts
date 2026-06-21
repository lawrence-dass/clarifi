// One-off recovery: re-request categorization for every account that still has
// uncategorized transactions (e.g. after categorize jobs failed and the outbox
// row was already marked processed). Enqueues fresh jobs the running worker
// picks up. Safe/idempotent: the job only touches rows with category = null.
// Run: set -a && source .env && set +a && pnpm --filter @clarifi/api exec tsx scripts/retrigger-categorization.ts
import { prisma } from "@clarifi/shared";
import { requestCategorization } from "../src/queues/categorize.outbox.js";

async function main() {
  const accounts = await prisma.transaction.groupBy({
    by: ["accountId"],
    where: { category: null, status: { not: "removed" } },
  });

  for (const { accountId } of accounts) {
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { userId: true },
    });
    if (!account) continue;
    await requestCategorization({ userId: account.userId, accountId });
    // eslint-disable-next-line no-console
    console.log(`re-requested categorization for account ${accountId}`);
  }

  // eslint-disable-next-line no-console
  console.log(`done — ${accounts.length} account(s) re-queued`);
  await prisma.$disconnect();
}

void main();
