import { describe, expect, it } from "vitest";
import { anonymizeDescription } from "./anonymize.js";

describe("anonymizeDescription", () => {
  it("redacts holder names case-insensitively", () => {
    expect(anonymizeDescription("PAYMENT TO Jane Doe", { holderName: "jane doe" })).toBe(
      "PAYMENT TO [NAME]",
    );
  });

  it("redacts direct contact and address-like PII", () => {
    const result = anonymizeDescription(
      "TRANSFER jane@example.com 604-555-1212 123 Main Street Vancouver BC V6B 1A1",
    );

    expect(result).toContain("[EMAIL]");
    expect(result).toContain("[PHONE]");
    expect(result).toContain("[ADDRESS]");
    expect(result).toContain("[POSTAL_CODE]");
    expect(result).not.toContain("jane@example.com");
    expect(result).not.toContain("604-555-1212");
    expect(result).not.toContain("123 Main Street");
    expect(result).not.toContain("V6B 1A1");
  });

  it("redacts names in e-transfer descriptions", () => {
    const result = anonymizeDescription("INTERAC E-TRANSFER FROM JANE MARIE DOE");

    expect(result).toContain("[NAME]");
    expect(result).not.toContain("JANE MARIE DOE");
  });

  it("redacts long digit runs and card-like separated digits", () => {
    expect(anonymizeDescription("CARD 4111 1111 1111 1111 ACCOUNT 123456789")).toBe(
      "CARD [ACCOUNT] ACCOUNT [ACCOUNT]",
    );
  });

  it("preserves ordinary merchant text", () => {
    expect(anonymizeDescription("TIM HORTONS #1234 VANCOUVER BC")).toBe(
      "TIM HORTONS #1234 VANCOUVER BC",
    );
  });
});
