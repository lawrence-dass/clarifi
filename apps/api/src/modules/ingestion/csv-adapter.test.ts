import { describe, expect, it } from "vitest";
import { parseCsvStatement } from "./csv-adapter.js";
import { BANK_PROFILES } from "./bank-profiles.js";

describe("parseCsvStatement", () => {
  it("TD: debit → negative cents, credit → positive cents", () => {
    const csv = [
      "Date,Description,Debit,Credit,Balance",
      "06/01/2026,COFFEE SHOP,4.50,,100.00",
      "06/02/2026,PAYROLL,,2000.00,2100.00",
    ].join("\n");
    const { transactions, errors } = parseCsvStatement(csv, BANK_PROFILES.td);

    expect(errors).toEqual([]);
    expect(transactions).toHaveLength(2);
    expect(transactions[0]!).toMatchObject({
      amountCents: -450n,
      currency: "CAD",
      rawDescription: "COFFEE SHOP",
    });
    expect(transactions[0]!.date.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(transactions[1]!.amountCents).toBe(200000n); // $2000.00 inflow
  });

  it("RBC: picks the populated currency column (CAD vs USD)", () => {
    const csv = [
      "Transaction Date,Description 1,Description 2,CAD$,USD$",
      "06/03/2026,AMAZON,PURCHASE,-31.99,",
      "06/04/2026,USD CHARGE,,,-10.00",
    ].join("\n");
    const { transactions, errors } = parseCsvStatement(csv, BANK_PROFILES.rbc);

    expect(errors).toEqual([]);
    expect(transactions[0]!).toMatchObject({ amountCents: -3199n, currency: "CAD", rawDescription: "AMAZON PURCHASE" });
    expect(transactions[1]!).toMatchObject({ amountCents: -1000n, currency: "USD", rawDescription: "USD CHARGE" });
  });

  it("RBC: includes currency in deterministic ids to avoid CAD/USD collisions", () => {
    const csv = [
      "Transaction Date,Description 1,Description 2,CAD$,USD$",
      "06/03/2026,TRANSFER,,10.00,",
      "06/03/2026,TRANSFER,,,10.00",
    ].join("\n");
    const first = parseCsvStatement(csv, BANK_PROFILES.rbc);
    const second = parseCsvStatement(csv, BANK_PROFILES.rbc);

    expect(first.errors).toEqual([]);
    expect(first.transactions.map((t) => t.providerTransactionId)).toEqual(
      second.transactions.map((t) => t.providerTransactionId),
    );
    expect(first.transactions[0]!.providerTransactionId).not.toBe(
      first.transactions[1]!.providerTransactionId,
    );
  });

  it("Scotiabank/generic: single signed column, generic uses ISO dates", () => {
    const scotia = parseCsvStatement(
      "Date,Description,Amount\n06/05/2026,HYDRO,-88.20",
      BANK_PROFILES.scotiabank,
    );
    expect(scotia.transactions[0]!).toMatchObject({ amountCents: -8820n, currency: "CAD" });

    const generic = parseCsvStatement(
      "Date,Description,Amount\n2026-06-06,REFUND,12.34",
      BANK_PROFILES.generic,
    );
    expect(generic.transactions[0]!.amountCents).toBe(1234n);
    expect(generic.transactions[0]!.date.toISOString()).toBe("2026-06-06T00:00:00.000Z");
  });

  it("collects malformed rows (bad date, non-numeric amount, missing description) without aborting", () => {
    const csv = [
      "Date,Description,Amount",
      "2026-06-01,GOOD,10.00",
      "2026-13-99,BAD DATE,5.00",
      "2026-06-02,BAD AMOUNT,abc",
      "2026-06-02,,9.99",
      "2026-06-03,ALSO GOOD,-7.00",
    ].join("\n");
    const { transactions, errors } = parseCsvStatement(csv, BANK_PROFILES.generic);

    expect(transactions).toHaveLength(2); // the two good rows still import
    expect(errors.map((e) => e.row)).toEqual([2, 3, 4]);
    expect(errors[0]!.reason).toMatch(/date/i);
    expect(errors[1]!.reason).toMatch(/amount/i);
    expect(errors[2]!.reason).toMatch(/description/i);
  });

  it("reports structural CSV parse errors", () => {
    const csv = [
      "Date,Description,Amount",
      '2026-06-01,"BROKEN,10.00',
      "2026-06-02,GOOD,2.00",
    ].join("\n");
    const { transactions, errors } = parseCsvStatement(csv, BANK_PROFILES.generic);

    expect(transactions).toHaveLength(0);
    expect(errors.some((e) => /quote/i.test(e.reason))).toBe(true);
  });

  it("rejects non-money numeric forms", () => {
    const csv = [
      "Date,Description,Amount",
      "2026-06-01,EXPONENT,1e3",
      "2026-06-02,HEX,0x10",
      "2026-06-03,TOO MANY DECIMALS,1.234",
      "2026-06-04,GOOD,1.23",
    ].join("\n");
    const { transactions, errors } = parseCsvStatement(csv, BANK_PROFILES.generic);

    expect(transactions).toHaveLength(1);
    expect(transactions[0]!.rawDescription).toBe("GOOD");
    expect(errors.map((e) => e.row)).toEqual([1, 2, 3]);
  });

  it("detects the real header after bank metadata rows", () => {
    const csv = [
      "Account Activity",
      "Exported,2026-06-15",
      "Date,Description,Debit,Credit,Balance",
      "06/01/2026,COFFEE SHOP,4.50,,100.00",
    ].join("\n");
    const { transactions, errors } = parseCsvStatement(csv, BANK_PROFILES.td);

    expect(errors).toEqual([]);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]!).toMatchObject({ amountCents: -450n, rawDescription: "COFFEE SHOP" });
  });

  it("derives a deterministic providerTransactionId, disambiguating identical rows", () => {
    const csv = [
      "Date,Description,Amount",
      "2026-06-01,COFFEE,-4.50",
      "2026-06-01,COFFEE,-4.50", // a genuine duplicate-looking row
    ].join("\n");
    const first = parseCsvStatement(csv, BANK_PROFILES.generic);
    const second = parseCsvStatement(csv, BANK_PROFILES.generic);

    // Stable across re-parses (enables Story 1.5 dedupe)...
    expect(first.transactions.map((t) => t.providerTransactionId)).toEqual(
      second.transactions.map((t) => t.providerTransactionId),
    );
    // ...but the two same-looking rows get distinct ids (occurrence index).
    expect(first.transactions[0]!.providerTransactionId).not.toBe(
      first.transactions[1]!.providerTransactionId,
    );
  });

  it("normalizes debit sign even if the bank wrote it positive", () => {
    // TD debit column holds a positive 12.00 → must become -1200 cents.
    const { transactions } = parseCsvStatement(
      "Date,Description,Debit,Credit\n06/01/2026,ATM,12.00,",
      BANK_PROFILES.td,
    );
    expect(transactions[0]!.amountCents).toBe(-1200n);
  });
});
