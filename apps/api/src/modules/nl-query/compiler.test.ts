import { describe, expect, it } from "vitest";
import { compileQueryIR } from "./compiler.js";
import type { QueryIR } from "@clarifi/shared";

const BASE_IR: QueryIR = {
  metric: "total_spend",
  dimensions: [],
  filters: [],
  timeRange: { start: "2026-06-01", end: "2026-06-30" },
  limit: 1,
  interpretation: "Total spend in June 2026.",
};

describe("compileQueryIR", () => {
  it("emits SELECT … FROM transactions t", () => {
    const { sql } = compileQueryIR(BASE_IR);
    expect(sql).toMatch(/FROM transactions t/i);
  });

  it("parameterizes start and end dates as first two params", () => {
    const { sql, params } = compileQueryIR(BASE_IR);
    expect(params[0]).toBe("2026-06-01");
    expect(params[1]).toBe("2026-06-30");
    expect(sql).toContain("$1");
    expect(sql).toContain("$2");
  });

  it("always includes status != 'removed' guard", () => {
    const { sql } = compileQueryIR(BASE_IR);
    expect(sql).toContain("t.status != 'removed'");
  });

  it("always includes LIMIT", () => {
    const { sql } = compileQueryIR({ ...BASE_IR, limit: 5 });
    expect(sql).toMatch(/LIMIT\s+5/i);
  });

  it("total_spend uses SUM with CASE for negative amounts", () => {
    const { sql } = compileQueryIR({ ...BASE_IR, metric: "total_spend" });
    expect(sql).toContain("amount_cents < 0");
    expect(sql).toContain("SUM(CASE");
  });

  it("total_income uses SUM with CASE for positive amounts", () => {
    const { sql } = compileQueryIR({ ...BASE_IR, metric: "total_income" });
    expect(sql).toContain("amount_cents > 0");
    expect(sql).toContain("SUM(CASE");
  });

  it("net uses SUM of all amount_cents", () => {
    const { sql } = compileQueryIR({ ...BASE_IR, metric: "net" });
    expect(sql).toContain("SUM(t.amount_cents)");
    expect(sql).not.toContain("CASE");
  });

  it("transaction_count uses COUNT(*)", () => {
    const { sql } = compileQueryIR({ ...BASE_IR, metric: "transaction_count" });
    expect(sql).toContain("COUNT(*)");
  });

  it("average_transaction uses AVG(ABS(...))", () => {
    const { sql } = compileQueryIR({ ...BASE_IR, metric: "average_transaction" });
    expect(sql).toContain("AVG(ABS(t.amount_cents))");
  });

  it("dimension query adds GROUP BY and ORDER BY", () => {
    const { sql } = compileQueryIR({ ...BASE_IR, dimensions: ["category"], limit: 10 });
    expect(sql).toMatch(/GROUP BY/i);
    expect(sql).toMatch(/ORDER BY value DESC/i);
    expect(sql).toContain("t.category AS category");
  });

  it("merchant dimension uses merchant_name column", () => {
    const { sql } = compileQueryIR({ ...BASE_IR, dimensions: ["merchant"], limit: 10 });
    expect(sql).toContain("t.merchant_name AS merchant");
    expect(sql).toContain("t.merchant_name");
  });

  it("month dimension uses DATE_TRUNC", () => {
    const { sql } = compileQueryIR({ ...BASE_IR, dimensions: ["month"], limit: 10 });
    expect(sql).toContain("DATE_TRUNC('month', t.date)");
  });

  it("account dimension uses account_id column", () => {
    const { sql } = compileQueryIR({ ...BASE_IR, dimensions: ["account"], limit: 10 });
    expect(sql).toContain("t.account_id AS account");
  });

  it("two dimensions produce two GROUP BY cols", () => {
    const { sql } = compileQueryIR({
      ...BASE_IR,
      dimensions: ["category", "month"],
      limit: 10,
    });
    expect(sql).toMatch(/GROUP BY.+,/s);
    expect(sql).toContain("t.category AS category");
    expect(sql).toContain("DATE_TRUNC('month', t.date) AS month");
  });

  it("scalar query (no dimensions) has no GROUP BY or ORDER BY", () => {
    const { sql } = compileQueryIR(BASE_IR);
    expect(sql).not.toMatch(/GROUP BY/i);
    expect(sql).not.toMatch(/ORDER BY/i);
  });

  it("eq filter parameterizes value", () => {
    const ir: QueryIR = {
      ...BASE_IR,
      filters: [{ field: "merchant", op: "eq", value: "Tim Hortons" }],
    };
    const { sql, params } = compileQueryIR(ir);
    expect(sql).toContain("t.merchant_name =");
    expect(params).toContain("Tim Hortons");
  });

  it("in filter uses = ANY(...)", () => {
    const ir: QueryIR = {
      ...BASE_IR,
      filters: [{ field: "category", op: "in", value: ["food_and_dining", "entertainment"] }],
    };
    const { sql, params } = compileQueryIR(ir);
    expect(sql).toContain("t.category = ANY(");
    expect(params).toContainEqual(["food_and_dining", "entertainment"]);
  });

  it("account filter uses account_id", () => {
    const ir: QueryIR = {
      ...BASE_IR,
      filters: [{ field: "account", op: "eq", value: "acct-123" }],
    };
    const { sql, params } = compileQueryIR(ir);
    expect(sql).toContain("t.account_id =");
    expect(params).toContain("acct-123");
  });

  it("multiple filters each get their own parameter", () => {
    const ir: QueryIR = {
      ...BASE_IR,
      filters: [
        { field: "category", op: "eq", value: "food_and_dining" },
        { field: "merchant", op: "eq", value: "Tim Hortons" },
      ],
    };
    const { params } = compileQueryIR(ir);
    expect(params).toContain("food_and_dining");
    expect(params).toContain("Tim Hortons");
  });

  it("returns value alias in SELECT", () => {
    const { sql } = compileQueryIR(BASE_IR);
    expect(sql).toContain("AS value");
  });
});
