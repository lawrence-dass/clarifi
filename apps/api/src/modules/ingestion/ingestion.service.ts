import { createHash } from "node:crypto";
import {
  withUserContext,
  directionFromCents,
  Provider,
  AccountType,
  type RowError,
} from "@clarifi/shared";
import { parseCsvStatement } from "./csv-adapter.js";
import { BANK_PROFILES, type BankFormat } from "./bank-profiles.js";
import { requestCategorization } from "../../queues/categorize.outbox.js";

const TRANSACTION_BATCH_SIZE = 1_000;

export interface ImportResult {
  accountId: string;
  imported: number;
  duplicatesSkipped: number;
  malformed: RowError[];
}

export interface ImportCsvInput {
  userId: string;
  bankFormat: BankFormat;
  institution: string;
  csv: string;
}

/**
 * Parse a CSV statement and persist its transactions under the user's RLS
 * context. The CSV adapter owns all sign/currency normalization; this service
 * only maps canonical rows to DB rows and writes them.
 *
 * A stable csv Account is upserted per (user, institution) so re-imports land
 * on the same account; transactions use a deterministic providerTransactionId,
 * so `createMany({ skipDuplicates })` makes a re-upload a no-op (Story 1.5 turns
 * this into a reporting upsert).
 */
export async function importCsv(input: ImportCsvInput): Promise<ImportResult> {
  const profile = BANK_PROFILES[input.bankFormat];
  const { transactions, errors } = parseCsvStatement(input.csv, profile);
  const institutionName = input.institution.trim();
  const institutionIdentity = normalizeInstitutionIdentity(institutionName);

  // Stable per (user, institution) — keeps the global (provider, providerAccountId)
  // unique key collision-free across users (userId is baked into the hash).
  const providerAccountId = createHash("sha256")
    .update(`${input.userId}:${institutionIdentity}`)
    .digest("hex");

  const result = await withUserContext(input.userId, async (tx) => {
    const account = await tx.account.upsert({
      where: { provider_providerAccountId: { provider: Provider.csv, providerAccountId } },
      create: {
        userId: input.userId,
        provider: Provider.csv,
        providerAccountId,
        institutionName,
        accountType: AccountType.other,
        balanceCents: 0n, // a CSV statement's running balance isn't trusted in v1
        currency: profile.defaultCurrency,
      },
      update: {}, // re-import doesn't mutate the account
      select: { id: true },
    });

    const data = transactions.map((t) => ({
      accountId: account.id,
      userId: input.userId,
      provider: Provider.csv,
      providerTransactionId: t.providerTransactionId,
      date: t.date,
      amountCents: t.amountCents,
      direction: directionFromCents(t.amountCents),
      currency: t.currency,
      rawDescription: t.rawDescription,
    }));

    const existingIds = new Set<string>();
    const providerTransactionIds = [...new Set(data.map((t) => t.providerTransactionId))];
    for (const idBatch of chunk(providerTransactionIds, TRANSACTION_BATCH_SIZE)) {
      const existingBatch = await tx.transaction.findMany({
        where: {
          accountId: account.id,
          providerTransactionId: { in: idBatch },
        },
        select: { providerTransactionId: true },
      });
      for (const existing of existingBatch) existingIds.add(existing.providerTransactionId);
    }

    const missing = data.filter((t) => !existingIds.has(t.providerTransactionId));
    let imported = 0;
    for (const dataBatch of chunk(missing, TRANSACTION_BATCH_SIZE)) {
      const result = await tx.transaction.createMany({ data: dataBatch, skipDuplicates: true });
      imported += result.count;
    }

    return {
      accountId: account.id,
      imported,
      duplicatesSkipped: data.length - imported,
      malformed: errors,
    };
  });

  if (result.imported > 0) {
    await requestCategorization({ userId: input.userId, accountId: result.accountId });
  }

  return result;
}

function normalizeInstitutionIdentity(institution: string): string {
  return institution.replace(/\s+/g, " ").trim().toLocaleLowerCase("en-CA");
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
