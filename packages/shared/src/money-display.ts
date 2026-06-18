/** Format integer cents as a localized currency string (display layer only). */
export function formatCents(
  cents: bigint,
  currency = "CAD",
  locale = "en-CA",
): string {
  const dollars = Number(cents) / 100;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(dollars);
}
