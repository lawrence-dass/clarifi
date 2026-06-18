import { z } from "zod";
import { AccountType, Provider } from "./generated/prisma/client.js";

/**
 * Provider-agnostic canonical transaction — the anti-corruption boundary
 * (CLAUDE.md). Every ingestion adapter (CSV now; Plaid/FDX later) maps its raw
 * shape into THIS, and the rest of the app only ever sees canonical rows.
 *
 * Money is signed integer cents (bigint), outflow negative / inflow positive,
 * with the provider's sign convention normalized exactly once in the adapter.
 */
export const CanonicalTransaction = z.object({
  // Deterministic, stable id from the source (CSV: a content hash; Plaid/FDX:
  // the provider's own id). Backs the (account_id, provider_transaction_id)
  // idempotency key.
  providerTransactionId: z.string().min(1),
  providerAccountId: z.string().min(1).optional(),
  date: z.date(),
  amountCents: z.bigint(), // signed: outflow < 0, inflow > 0
  currency: z.string().length(3), // ISO 4217, e.g. "CAD"
  rawDescription: z.string().min(1),
  merchantName: z.string().optional(),
  pending: z.boolean().optional(),
  pendingTransactionId: z.string().nullable().optional(),
});

export type CanonicalTransaction = z.infer<typeof CanonicalTransaction>;

/** A row that could not be parsed — collected, never thrown (partial import). */
export interface RowError {
  row: number; // 1-based data row number (excludes the header)
  reason: string;
}

export const CanonicalAccount = z.object({
  provider: z.literal(Provider.plaid),
  providerAccountId: z.string().min(1),
  institutionName: z.string().min(1),
  accountType: z.nativeEnum(AccountType),
  balanceCents: z.bigint(),
  currency: z.string().length(3),
  mask: z.string().optional(),
});

export type CanonicalAccount = z.infer<typeof CanonicalAccount>;
