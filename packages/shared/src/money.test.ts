import { describe, it, expect } from "vitest";
import { dollarsToCents, formatCents, directionFromCents, sumCents } from "./money.js";
import { TransactionDirection } from "./generated/prisma/client.js";

describe("dollarsToCents", () => {
  it("converts dollars to integer cents", () => {
    expect(dollarsToCents(12.34)).toBe(1234n);
  });

  it("rounds to the nearest cent (no float drift)", () => {
    // 0.1 + 0.2 in float is 0.30000000000000004 — must still store 30 cents.
    expect(dollarsToCents(0.1 + 0.2)).toBe(30n);
  });

  it("handles negative (outflow) amounts", () => {
    expect(dollarsToCents(-84.7)).toBe(-8470n);
  });

  it("rejects non-finite input", () => {
    expect(() => dollarsToCents(NaN)).toThrow();
  });
});

describe("formatCents", () => {
  it("formats CAD by default", () => {
    expect(formatCents(8470n)).toBe("$84.70");
  });
});

describe("directionFromCents", () => {
  it("negative is debit, positive is credit", () => {
    expect(directionFromCents(-1n)).toBe(TransactionDirection.debit);
    expect(directionFromCents(1n)).toBe(TransactionDirection.credit);
    expect(directionFromCents(0n)).toBe(TransactionDirection.credit);
  });
});

describe("sumCents", () => {
  it("sums same-currency amounts in integer space", () => {
    const { totalCents, currency } = sumCents([
      { amountCents: 1000n, currency: "CAD" },
      { amountCents: -250n, currency: "CAD" },
    ]);
    expect(totalCents).toBe(750n);
    expect(currency).toBe("CAD");
  });

  it("refuses to mix currencies", () => {
    expect(() =>
      sumCents([
        { amountCents: 1000n, currency: "CAD" },
        { amountCents: 1000n, currency: "USD" },
      ]),
    ).toThrow(/mix currencies/);
  });
});
