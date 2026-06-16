import { describe, expect, it } from "vitest";
import { merchantNameKey, normalizeMerchantName } from "./merchant-normalizer.js";

describe("normalizeMerchantName", () => {
  it("normalizes noisy Tim Hortons descriptions", () => {
    expect(normalizeMerchantName("TIM HORTONS #1234 VANCOUVER BC")).toBe("Tim Hortons");
  });

  it("removes payment prefixes, reference tokens, and location suffixes", () => {
    expect(normalizeMerchantName("POS PURCHASE STARBUCKS STORE 4421 TORONTO ON")).toBe("Starbucks");
    expect(normalizeMerchantName("VISA DEBIT WALMART REF 992113 CALGARY AB")).toBe("Walmart");
  });

  it("does not preserve obvious PII in normalized names", () => {
    expect(normalizeMerchantName("TRANSFER jane@example.com 604-555-1212 4111 1111 1111 1111")).toBeNull();
  });

  it("title-cases unknown merchant text conservatively", () => {
    expect(normalizeMerchantName("LOCAL COFFEE ROASTERS VICTORIA BC")).toBe("Local Coffee Roasters");
  });

  it("treats person-to-person transfers/payments as non-merchant (no name leak)", () => {
    expect(normalizeMerchantName("PAYMENT TO JANE DOE")).toBeNull();
    expect(normalizeMerchantName("INTERAC E-TRANSFER FROM JOHN SMITH")).toBeNull();
    expect(normalizeMerchantName("E-TFR TO BOB JONES")).toBeNull();
    expect(normalizeMerchantName("TRANSFER TO MARIE-CLAIRE TREMBLAY")).toBeNull();
  });

  it("redacts the account holder name from normalized output", () => {
    expect(normalizeMerchantName("THE JANE DOE BAKERY", { holderName: "Jane Doe" })).toBe("The Bakery");
  });
});

describe("merchantNameKey", () => {
  it("creates stable safe key fragments", () => {
    expect(merchantNameKey("Tim Hortons")).toBe("tim-hortons");
    expect(merchantNameKey("A&W")).toBe("a-w");
  });
});
