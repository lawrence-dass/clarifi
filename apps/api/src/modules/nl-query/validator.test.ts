import { describe, expect, it } from "vitest";
import type { QueryIR } from "@clarifi/shared";
import { validateSQL, SQLValidationError } from "./validator.js";
import { compileQueryIR } from "./compiler.js";

const BASE_IR: QueryIR = {
  metric: "total_spend",
  dimensions: [],
  filters: [],
  timeRange: { start: "2026-06-01", end: "2026-06-30" },
  limit: 10,
  interpretation: "x",
};

const VALID_SQL = `SELECT t.category AS category, COALESCE(SUM(CASE WHEN t.amount_cents < 0 THEN t.amount_cents ELSE 0 END), 0::bigint) AS value
FROM transactions t
WHERE t.date >= $1::date AND t.date <= $2::date AND t.status != 'removed'
GROUP BY t.category
ORDER BY value DESC NULLS LAST
LIMIT 10`;

describe("validateSQL", () => {
  it("accepts valid generated SQL", () => {
    expect(() => validateSQL(VALID_SQL)).not.toThrow();
  });

  it("rejects SQL not starting with SELECT", () => {
    expect(() => validateSQL("DELETE FROM transactions t WHERE 1=1 LIMIT 1")).toThrow(
      SQLValidationError,
    );
  });

  it("rejects UPDATE statement", () => {
    expect(() => validateSQL("UPDATE transactions SET status='removed' WHERE id=$1 LIMIT 1")).toThrow(
      SQLValidationError,
    );
  });

  it("rejects INSERT statement embedded after SELECT", () => {
    // A subversion attempt: begin with SELECT but include INSERT in body
    expect(() =>
      validateSQL("SELECT 1; INSERT INTO transactions VALUES (1) LIMIT 1"),
    ).toThrow(SQLValidationError);
  });

  it("rejects SQL without LIMIT", () => {
    const noLimit = `SELECT COUNT(*) AS value FROM transactions t WHERE t.date >= $1::date AND t.date <= $2::date AND t.status != 'removed'`;
    expect(() => validateSQL(noLimit)).toThrow(SQLValidationError);
  });

  it("rejects multiple statements (semicolon in body)", () => {
    expect(() => validateSQL("SELECT 1 AS value FROM transactions t LIMIT 1; SELECT 2")).toThrow(
      SQLValidationError,
    );
  });

  it("accepts trailing semicolon on single statement", () => {
    expect(() => validateSQL("SELECT COUNT(*) AS value FROM transactions t WHERE t.date >= $1::date AND t.date <= $2::date AND t.status != 'removed' LIMIT 1;")).not.toThrow();
  });

  it("rejects unknown table in FROM", () => {
    expect(() =>
      validateSQL("SELECT id FROM users u WHERE u.id = $1 LIMIT 1"),
    ).toThrow(SQLValidationError);
  });

  it("rejects subqueries (nested SELECT)", () => {
    expect(() =>
      validateSQL(
        "SELECT (SELECT COUNT(*) FROM transactions t2 LIMIT 1) AS value FROM transactions t LIMIT 1",
      ),
    ).toThrow(SQLValidationError);
  });

  it("rejects UNION", () => {
    const unionSql = `SELECT COUNT(*) AS value FROM transactions t LIMIT 10
UNION
SELECT COUNT(*) AS value FROM transactions t LIMIT 10`;
    expect(() => validateSQL(unionSql)).toThrow(SQLValidationError);
  });

  it("rejects INTERSECT", () => {
    expect(() =>
      validateSQL(
        "SELECT COUNT(*) AS value FROM transactions t LIMIT 1 INTERSECT SELECT COUNT(*) AS value FROM transactions t LIMIT 1",
      ),
    ).toThrow(SQLValidationError);
  });

  it("rejects DROP statement", () => {
    expect(() =>
      validateSQL("SELECT 1 AS value FROM transactions t WHERE DROP TABLE transactions LIMIT 1"),
    ).toThrow(SQLValidationError);
  });

  it("rejects TRUNCATE", () => {
    expect(() =>
      validateSQL("SELECT 1 AS value FROM transactions t WHERE TRUNCATE transactions LIMIT 1"),
    ).toThrow(SQLValidationError);
  });

  it("accepts valid scalar query (no GROUP BY)", () => {
    const scalar = `SELECT COALESCE(SUM(t.amount_cents), 0::bigint) AS value
FROM transactions t
WHERE t.date >= $1::date AND t.date <= $2::date AND t.status != 'removed'
LIMIT 1`;
    expect(() => validateSQL(scalar)).not.toThrow();
  });

  // The validator must accept everything the compiler can emit (allowlist must
  // not be tighter than the compiler).
  it("accepts compiled SQL for every metric", () => {
    for (const metric of [
      "total_spend",
      "total_income",
      "net",
      "transaction_count",
      "average_transaction",
    ] as const) {
      const { sql } = compileQueryIR({ ...BASE_IR, metric, limit: 1 });
      expect(() => validateSQL(sql)).not.toThrow();
    }
  });

  it("accepts compiled SQL with an eq filter", () => {
    const { sql } = compileQueryIR({
      ...BASE_IR,
      filters: [{ field: "merchant", op: "eq", value: "Tim Hortons" }],
    });
    expect(() => validateSQL(sql)).not.toThrow();
  });

  it("accepts compiled SQL with an in filter (col = ANY($n))", () => {
    const { sql } = compileQueryIR({
      ...BASE_IR,
      filters: [{ field: "category", op: "in", value: ["food_and_dining", "transport"] }],
    });
    expect(() => validateSQL(sql)).not.toThrow();
  });

  it("accepts compiled SQL with multiple dimensions", () => {
    const { sql } = compileQueryIR({ ...BASE_IR, dimensions: ["category", "month"] });
    expect(() => validateSQL(sql)).not.toThrow();
  });

  // Allowlist behaviour (not just blocklist): unknown columns/functions are rejected.
  it("rejects an unknown qualified column", () => {
    expect(() =>
      validateSQL("SELECT t.password_hash AS value FROM transactions t LIMIT 1"),
    ).toThrow(SQLValidationError);
  });

  it("rejects a non-allowlisted function", () => {
    expect(() => validateSQL("SELECT pg_sleep(10) AS value FROM transactions t LIMIT 1")).toThrow(
      SQLValidationError,
    );
  });

  it("rejects a JOIN to another table", () => {
    expect(() =>
      validateSQL(
        "SELECT t.category AS value FROM transactions t JOIN users u ON u.id = t.user_id LIMIT 1",
      ),
    ).toThrow(SQLValidationError);
  });

  it("SQLValidationError has correct name", () => {
    try {
      validateSQL("DELETE FROM transactions t LIMIT 1");
    } catch (e) {
      expect(e).toBeInstanceOf(SQLValidationError);
      expect((e as SQLValidationError).name).toBe("SQLValidationError");
    }
  });
});
