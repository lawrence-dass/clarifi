import { createHash } from "node:crypto";
import Papa from "papaparse";
import { dollarsToCents, type CanonicalTransaction, type RowError } from "@clarifi/shared";
import type { BankProfile, DateFormat } from "./bank-profiles.js";

export interface ParseResult {
  transactions: CanonicalTransaction[];
  errors: RowError[];
}

/**
 * Parse a bank CSV into canonical transactions — the anti-corruption layer.
 * The bank's sign convention is normalized to signed cents (outflow < 0) HERE,
 * once. A row that can't be parsed is collected into `errors` (with its 1-based
 * data-row number) and skipped; it never aborts the whole import.
 */
export function parseCsvStatement(csv: string, profile: BankProfile): ParseResult {
  const csvWithHeader = normalizeCsvHeader(csv, profile);
  const normalizedParsed = Papa.parse<Record<string, string>>(csvWithHeader, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });

  const transactions: CanonicalTransaction[] = [];
  const errors: RowError[] = normalizedParsed.errors.map((error) => ({
    row: typeof error.row === "number" ? error.row + 1 : 0,
    reason: error.message,
  }));
  // Disambiguates byte-identical rows in one file so the derived id is stable
  // AND unique: the Nth occurrence of the same (date, amount, currency, description).
  const occurrences = new Map<string, number>();

  normalizedParsed.data.forEach((rawRow, i) => {
    const row = i + 1; // 1-based, excludes the detected header
    try {
      const date = parseDate((rawRow[profile.dateColumn] ?? "").trim(), profile.dateFormat);
      const { amountCents, currency } = readAmount(rawRow, profile);
      const rawDescription = profile.descriptionColumns
        .map((c) => (rawRow[c] ?? "").trim())
        .filter((s) => s.length > 0)
        .join(" ");
      if (rawDescription === "") throw new Error("missing description");

      const contentKey = `${date.toISOString()}|${amountCents}|${currency}|${rawDescription}`;
      const occ = occurrences.get(contentKey) ?? 0;
      occurrences.set(contentKey, occ + 1);
      const providerTransactionId = createHash("sha256")
        .update(`${contentKey}|${occ}`)
        .digest("hex");

      transactions.push({
        providerTransactionId,
        date,
        amountCents,
        currency,
        rawDescription,
      });
    } catch (err) {
      errors.push({ row, reason: err instanceof Error ? err.message : "unparseable row" });
    }
  });

  return { transactions, errors };
}

function normalizeCsvHeader(csv: string, profile: BankProfile): string {
  const lines = csv.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => {
    const parsed = Papa.parse<string[]>(line, { skipEmptyLines: true });
    const headers = (parsed.data[0] ?? []).map((h) => h.trim());
    return profile.requiredHeaders.every((header) => headers.includes(header));
  });

  if (headerIndex === -1) {
    return csv;
  }

  return lines.slice(headerIndex).join("\n");
}

/** Parse a date string in the profile's format into a UTC Date. Throws if invalid. */
function parseDate(value: string, format: DateFormat): Date {
  if (!value) throw new Error("missing date");
  let y: number, m: number, d: number;
  if (format === "YYYY-MM-DD") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) throw new Error(`invalid date "${value}" (expected YYYY-MM-DD)`);
    [, y, m, d] = match.map(Number) as unknown as [string, number, number, number];
  } else {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
    if (!match) throw new Error(`invalid date "${value}" (expected MM/DD/YYYY)`);
    m = Number(match[1]);
    d = Number(match[2]);
    y = Number(match[3]);
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  // Reject impossible dates (e.g. 13/40) — Date would roll them over silently.
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new Error(`invalid date "${value}"`);
  }
  return date;
}

/** Read the signed amount (cents) + currency per the profile. Throws on a bad/missing amount. */
function readAmount(
  row: Record<string, string>,
  profile: BankProfile,
): { amountCents: bigint; currency: string } {
  const spec = profile.amount;

  if (spec.kind === "signed") {
    const value = parseMoney(row[spec.column]);
    if (value === null) throw new Error(`missing or non-numeric amount in "${spec.column}"`);
    return { amountCents: dollarsToCents(value), currency: profile.defaultCurrency };
  }

  if (spec.kind === "debitCredit") {
    const debit = parseMoney(row[spec.debit]);
    const credit = parseMoney(row[spec.credit]);
    if (debit !== null && credit !== null) {
      throw new Error("both debit and credit populated");
    }
    if (debit !== null) {
      // Debit column = outflow → negative, regardless of how the bank signed it.
      return { amountCents: dollarsToCents(-Math.abs(debit)), currency: profile.defaultCurrency };
    }
    if (credit !== null) {
      return { amountCents: dollarsToCents(Math.abs(credit)), currency: profile.defaultCurrency };
    }
    throw new Error("no debit or credit amount");
  }

  // signedByCurrency: first populated column wins (e.g. RBC CAD$ vs USD$).
  for (const { column, currency } of spec.columns) {
    const value = parseMoney(row[column]);
    if (value !== null) return { amountCents: dollarsToCents(value), currency };
  }
  throw new Error("no amount in any currency column");
}

/**
 * Parse a money string to a number (sign preserved), or null if blank.
 * Strips $, thousands separators, and whitespace; treats parenthesized values
 * `($12.34)` as negative. Throws if non-blank but not a finite number.
 */
function parseMoney(raw: string | undefined): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  const negativeParens = /^\(.*\)$/.test(trimmed);
  const cleaned = trimmed.replace(/[(),$\s]/g, "");
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(cleaned)) {
    throw new Error(`non-numeric amount "${raw}"`);
  }

  const n = Number(cleaned);
  if (!Number.isFinite(n)) throw new Error(`non-numeric amount "${raw}"`);
  return negativeParens ? -Math.abs(n) : n;
}
