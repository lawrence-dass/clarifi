/**
 * Money utilities. Guardrail (CLAUDE.md): money is integer cents (bigint),
 * never a float. These helpers are the ONLY sanctioned boundary between
 * stored cents and human-facing dollar strings. Do all arithmetic in cents.
 *
 * Sign convention: amounts are signed from the user's perspective —
 * outflow negative, inflow positive.
 */

import { TransactionDirection } from "./generated/prisma/client.js";
export { formatCents } from "./money-display.js";

/**
 * Convert a decimal dollar amount (e.g. from a CSV or API) to integer cents.
 * Rounds to the nearest cent to avoid float drift sneaking into storage.
 */
export function dollarsToCents(dollars: number): bigint {
  if (!Number.isFinite(dollars)) {
    throw new Error(`dollarsToCents: non-finite input ${dollars}`);
  }
  // Round in float space then convert — input is already an imprecise float,
  // so this is the safe one-time crossing into the integer domain.
  return BigInt(Math.round(dollars * 100));
}

/** Derive the direction enum from a signed cents amount. */
export function directionFromCents(cents: bigint): TransactionDirection {
  return cents < 0n ? TransactionDirection.debit : TransactionDirection.credit;
}

/**
 * Sum integer cents safely. Returns a per-currency total and throws if asked to
 * mix currencies — guardrail: aggregations never cross currencies.
 */
export function sumCents(
  items: ReadonlyArray<{ amountCents: bigint; currency: string }>,
): { totalCents: bigint; currency: string } {
  if (items.length === 0) return { totalCents: 0n, currency: "CAD" };
  const currency = items[0]!.currency;
  let total = 0n;
  for (const item of items) {
    if (item.currency !== currency) {
      throw new Error(
        `sumCents: refusing to mix currencies (${currency} vs ${item.currency})`,
      );
    }
    total += item.amountCents;
  }
  return { totalCents: total, currency };
}
