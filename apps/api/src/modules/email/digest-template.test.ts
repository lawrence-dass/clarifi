import { describe, it, expect } from "vitest";
import { buildDigestSubject, buildDigestText, buildDigestHtml } from "./digest-template.js";
import type { DigestData } from "./digest.service.js";

const baseData: DigestData = {
  userId: "user-1",
  email: "test@example.com",
  weekStart: "2026-06-08",
  weekEnd: "2026-06-14",
  totalSpendCents: -15000n,
  currency: "CAD",
  topCategories: [],
  criticalAnomalyCount: 0,
  overBudgetCategories: [],
};

describe("buildDigestSubject", () => {
  it("includes the formatted spend amount", () => {
    const subject = buildDigestSubject(baseData);
    expect(subject).toContain("CAD $150.00");
  });

  it("includes the week range", () => {
    const subject = buildDigestSubject(baseData);
    expect(subject).toContain("2026-06-08");
    expect(subject).toContain("2026-06-14");
  });

  it("treats positive cents as spend (zero spend)", () => {
    const subject = buildDigestSubject({ ...baseData, totalSpendCents: 0n });
    expect(subject).toContain("$0.00");
  });
});

describe("buildDigestText", () => {
  it("includes email and period", () => {
    const text = buildDigestText(baseData);
    expect(text).toContain("test@example.com");
    expect(text).toContain("2026-06-08");
    expect(text).toContain("2026-06-14");
  });

  it("formats total spend correctly", () => {
    const text = buildDigestText(baseData);
    expect(text).toContain("CAD $150.00");
  });

  it("lists top categories", () => {
    const data: DigestData = {
      ...baseData,
      topCategories: [
        { category: "food_and_drink", totalCents: -5000n },
        { category: "shopping", totalCents: -3000n },
      ],
    };
    const text = buildDigestText(data);
    expect(text).toContain("Food And Drink");
    expect(text).toContain("Shopping");
    expect(text).toContain("CAD $50.00");
    expect(text).toContain("CAD $30.00");
  });

  it("includes critical anomaly count when > 0", () => {
    const data: DigestData = { ...baseData, criticalAnomalyCount: 3 };
    const text = buildDigestText(data);
    expect(text).toContain("Critical anomalies: 3");
  });

  it("omits critical anomaly section when count is 0", () => {
    const text = buildDigestText(baseData);
    expect(text).not.toContain("Critical anomal");
  });

  it("includes budget alerts when over budget", () => {
    const data: DigestData = {
      ...baseData,
      overBudgetCategories: [{ category: "dining", percentUsed: 110 }],
    };
    const text = buildDigestText(data);
    expect(text).toContain("Budget alerts");
    expect(text).toContain("Dining");
    expect(text).toContain("Over budget");
  });

  it("labels near-limit categories correctly", () => {
    const data: DigestData = {
      ...baseData,
      overBudgetCategories: [{ category: "groceries", percentUsed: 85 }],
    };
    const text = buildDigestText(data);
    expect(text).toContain("Near limit");
    expect(text).not.toContain("Over budget");
  });

  it("omits budget section when empty", () => {
    const text = buildDigestText(baseData);
    expect(text).not.toContain("Budget alerts");
  });
});

describe("buildDigestHtml", () => {
  it("returns valid HTML with DOCTYPE", () => {
    const html = buildDigestHtml(baseData);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
  });

  it("includes total spend in HTML", () => {
    const html = buildDigestHtml(baseData);
    expect(html).toContain("CAD $150.00");
  });

  it("includes the week range in HTML", () => {
    const html = buildDigestHtml(baseData);
    expect(html).toContain("2026-06-08");
    expect(html).toContain("2026-06-14");
  });

  it("renders anomaly alert block when criticalAnomalyCount > 0", () => {
    const data: DigestData = { ...baseData, criticalAnomalyCount: 2 };
    const html = buildDigestHtml(data);
    expect(html).toContain("2 critical anomaly alerts");
  });

  it("omits anomaly block when count is 0", () => {
    const html = buildDigestHtml(baseData);
    expect(html).not.toContain("critical anomaly");
  });

  it("renders categories table when topCategories is populated", () => {
    const data: DigestData = {
      ...baseData,
      topCategories: [{ category: "travel", totalCents: -20000n }],
    };
    const html = buildDigestHtml(data);
    expect(html).toContain("Travel");
    expect(html).toContain("CAD $200.00");
  });

  it("renders budget alert block when overBudgetCategories is populated", () => {
    const data: DigestData = {
      ...baseData,
      overBudgetCategories: [{ category: "entertainment", percentUsed: 100 }],
    };
    const html = buildDigestHtml(data);
    expect(html).toContain("Budget alerts");
    expect(html).toContain("over budget");
  });
});
