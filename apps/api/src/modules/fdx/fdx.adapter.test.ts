import { describe, expect, it } from "vitest";
import { toFDXAccount, toFDXTransaction, toFDXCustomer } from "./fdx.adapter.js";

const ACCOUNT_ROW = {
  id: "acct-001",
  institutionName: "TD Bank",
  accountType: "checking" as const,
  balanceCents: 123456n,
  currency: "CAD",
};

const TX_ROW = {
  id: "tx-001",
  accountId: "acct-001",
  date: new Date("2026-06-15T12:00:00Z"),
  amountCents: -4500n,
  direction: "debit" as const,
  currency: "CAD",
  rawDescription: "TIM HORTONS #123",
  merchantName: "Tim Hortons",
  category: "food_and_dining",
  status: "posted" as const,
};

describe("toFDXAccount", () => {
  it("maps accountId, displayName, and currency", () => {
    const r = toFDXAccount(ACCOUNT_ROW);
    expect(r.accountId).toBe("acct-001");
    expect(r.displayName).toBe("TD Bank");
    expect(r.currency.currencyCode).toBe("CAD");
    expect(r.status).toBe("OPEN");
  });

  it("converts balance from cents to dollars", () => {
    const r = toFDXAccount(ACCOUNT_ROW);
    expect(r.currentBalance).toBe(1234.56);
  });

  it("maps checking → CHECKING", () => {
    expect(toFDXAccount({ ...ACCOUNT_ROW, accountType: "checking" }).accountType).toBe("CHECKING");
  });

  it("maps savings → SAVINGS", () => {
    expect(toFDXAccount({ ...ACCOUNT_ROW, accountType: "savings" }).accountType).toBe("SAVINGS");
  });

  it("maps credit_card → CREDITCARD", () => {
    expect(
      toFDXAccount({ ...ACCOUNT_ROW, accountType: "credit_card" }).accountType,
    ).toBe("CREDITCARD");
  });

  it("maps other → INVESTMENT", () => {
    expect(toFDXAccount({ ...ACCOUNT_ROW, accountType: "other" }).accountType).toBe("INVESTMENT");
  });
});

describe("toFDXTransaction", () => {
  it("maps transactionId and accountId", () => {
    const r = toFDXTransaction(TX_ROW);
    expect(r.transactionId).toBe("tx-001");
    expect(r.accountId).toBe("acct-001");
  });

  it("converts amount from cents to absolute dollars", () => {
    const r = toFDXTransaction(TX_ROW);
    expect(r.amount).toBe(45); // |−4500 cents| / 100
  });

  it("maps debit direction → DEBIT transactionType", () => {
    const r = toFDXTransaction(TX_ROW);
    expect(r.transactionType).toBe("DEBIT");
  });

  it("maps credit direction → CREDIT transactionType", () => {
    const r = toFDXTransaction({ ...TX_ROW, direction: "credit" as const, amountCents: 10000n });
    expect(r.transactionType).toBe("CREDIT");
  });

  it("sets postedDate to YYYY-MM-DD for posted transactions", () => {
    const r = toFDXTransaction(TX_ROW);
    expect(r.postedDate).toBe("2026-06-15");
    expect(r.status).toBe("POSTED");
  });

  it("sets postedDate to null for pending transactions", () => {
    const r = toFDXTransaction({ ...TX_ROW, status: "pending" as const });
    expect(r.postedDate).toBeNull();
    expect(r.status).toBe("PENDING");
  });

  it("maps removed status correctly", () => {
    const r = toFDXTransaction({ ...TX_ROW, status: "removed" as const });
    expect(r.status).toBe("REMOVED");
  });

  it("preserves merchantName and category", () => {
    const r = toFDXTransaction(TX_ROW);
    expect(r.merchantName).toBe("Tim Hortons");
    expect(r.category).toBe("food_and_dining");
  });

  it("passes through null merchantName", () => {
    const r = toFDXTransaction({ ...TX_ROW, merchantName: null });
    expect(r.merchantName).toBeNull();
  });
});

describe("toFDXCustomer", () => {
  it("maps customerId from user id", () => {
    const r = toFDXCustomer({ id: "user-001", email: "a@b.com" });
    expect(r.customerId).toBe("user-001");
    expect(r.email).toBe("a@b.com");
  });
});
