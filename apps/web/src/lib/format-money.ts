import { formatCents } from "@clarifi/shared/money-display";

export function formatMoney(cents: bigint | number | string, currency = "CAD"): string {
  return formatCents(BigInt(cents), currency);
}
