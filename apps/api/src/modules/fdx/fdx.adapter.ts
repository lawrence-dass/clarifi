/**
 * FDX anti-corruption adapter (CLAUDE.md guardrail).
 *
 * Maps Clarifi's canonical domain model to the FDX API format.
 * This is the ONLY place in the codebase that knows about FDX field names.
 * Plaid, CSV, and FDX are interchangeable; the core domain never changes.
 *
 * Amounts converted to dollars here — this IS the display layer (adapter output).
 */

import type { AccountType, TransactionDirection, TransactionStatus } from "@clarifi/shared";

// ── FDX schema types (simplified credible slice) ────────────────────────────

export interface FDXCurrency {
  currencyCode: string;
}

export interface FDXAccount {
  accountId: string;
  displayName: string;
  accountType: FDXAccountType;
  currency: FDXCurrency;
  currentBalance: number; // dollars
  status: "OPEN";
}

export interface FDXTransaction {
  transactionId: string;
  accountId: string;
  postedDate: string | null; // YYYY-MM-DD; null if pending
  amount: number; // dollars, absolute value (sign conveyed by transactionType)
  currencyCode: string;
  transactionType: "DEBIT" | "CREDIT";
  description: string;
  merchantName: string | null;
  category: string | null;
  status: FDXTransactionStatus;
}

export interface FDXCustomer {
  customerId: string;
  email: string;
}

export type FDXAccountType = "CHECKING" | "SAVINGS" | "CREDITCARD" | "INVESTMENT";
export type FDXTransactionStatus = "POSTED" | "PENDING" | "REMOVED";

// ── Mapping helpers ─────────────────────────────────────────────────────────

const ACCOUNT_TYPE_MAP: Record<AccountType, FDXAccountType> = {
  checking: "CHECKING",
  savings: "SAVINGS",
  credit_card: "CREDITCARD",
  other: "INVESTMENT",
};

const TX_STATUS_MAP: Record<TransactionStatus, FDXTransactionStatus> = {
  posted: "POSTED",
  pending: "PENDING",
  removed: "REMOVED",
};

export function toFDXAccount(row: {
  id: string;
  institutionName: string;
  accountType: AccountType;
  balanceCents: bigint;
  currency: string;
}): FDXAccount {
  return {
    accountId: row.id,
    displayName: row.institutionName,
    accountType: ACCOUNT_TYPE_MAP[row.accountType],
    currency: { currencyCode: row.currency },
    currentBalance: Number(row.balanceCents) / 100,
    status: "OPEN",
  };
}

export function toFDXTransaction(row: {
  id: string;
  accountId: string;
  date: Date;
  amountCents: bigint;
  direction: TransactionDirection;
  currency: string;
  rawDescription: string;
  merchantName: string | null;
  category: string | null;
  status: TransactionStatus;
}): FDXTransaction {
  const isPosted = row.status === "posted";
  return {
    transactionId: row.id,
    accountId: row.accountId,
    postedDate: isPosted ? row.date.toISOString().slice(0, 10) : null,
    amount: Math.abs(Number(row.amountCents)) / 100,
    currencyCode: row.currency,
    transactionType: row.direction === "debit" ? "DEBIT" : "CREDIT",
    description: row.rawDescription,
    merchantName: row.merchantName,
    category: row.category,
    status: TX_STATUS_MAP[row.status],
  };
}

export function toFDXCustomer(row: { id: string; email: string }): FDXCustomer {
  return { customerId: row.id, email: row.email };
}
