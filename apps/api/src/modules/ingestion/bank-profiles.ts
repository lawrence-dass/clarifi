import { z } from "zod";

/**
 * Bank CSV profiles — the per-provider column mapping the CSV adapter uses to
 * project a raw statement into the canonical model. Adding a bank = adding a
 * profile here; the adapter and the rest of the app stay untouched.
 */

export const BankFormat = z.enum(["td", "rbc", "scotiabank", "generic"]);
export type BankFormat = z.infer<typeof BankFormat>;

export type DateFormat = "YYYY-MM-DD" | "MM/DD/YYYY";

/** How a row's signed amount + currency are read. */
export type AmountSpec =
  // Two columns; at most one populated. Debit = outflow (negative), credit = inflow (positive).
  | { kind: "debitCredit"; debit: string; credit: string }
  // One already-signed column (banks sign from the customer's view: debit < 0).
  | { kind: "signed"; column: string }
  // One signed column per currency; the first populated one wins (e.g. RBC CAD$/USD$).
  | { kind: "signedByCurrency"; columns: { column: string; currency: string }[] };

export interface BankProfile {
  format: BankFormat;
  requiredHeaders: string[];
  dateColumn: string;
  dateFormat: DateFormat;
  descriptionColumns: string[];
  amount: AmountSpec;
  defaultCurrency: string;
}

export const BANK_PROFILES: Record<BankFormat, BankProfile> = {
  td: {
    format: "td",
    requiredHeaders: ["Date", "Description", "Debit", "Credit"],
    dateColumn: "Date",
    dateFormat: "MM/DD/YYYY",
    descriptionColumns: ["Description"],
    amount: { kind: "debitCredit", debit: "Debit", credit: "Credit" },
    defaultCurrency: "CAD",
  },
  rbc: {
    format: "rbc",
    requiredHeaders: ["Transaction Date", "Description 1", "CAD$", "USD$"],
    dateColumn: "Transaction Date",
    dateFormat: "MM/DD/YYYY",
    descriptionColumns: ["Description 1", "Description 2"],
    amount: {
      kind: "signedByCurrency",
      columns: [
        { column: "CAD$", currency: "CAD" },
        { column: "USD$", currency: "USD" },
      ],
    },
    defaultCurrency: "CAD",
  },
  scotiabank: {
    format: "scotiabank",
    requiredHeaders: ["Date", "Description", "Amount"],
    dateColumn: "Date",
    dateFormat: "MM/DD/YYYY",
    descriptionColumns: ["Description"],
    amount: { kind: "signed", column: "Amount" },
    defaultCurrency: "CAD",
  },
  generic: {
    format: "generic",
    requiredHeaders: ["Date", "Description", "Amount"],
    dateColumn: "Date",
    dateFormat: "YYYY-MM-DD",
    descriptionColumns: ["Description"],
    amount: { kind: "signed", column: "Amount" },
    defaultCurrency: "CAD",
  },
};
