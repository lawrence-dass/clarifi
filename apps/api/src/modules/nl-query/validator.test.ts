import { describe, expect, it } from "vitest";
import { validateSQL, SQLValidationError } from "./validator.js";

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

  it("SQLValidationError has correct name", () => {
    try {
      validateSQL("DELETE FROM transactions t LIMIT 1");
    } catch (e) {
      expect(e).toBeInstanceOf(SQLValidationError);
      expect((e as SQLValidationError).name).toBe("SQLValidationError");
    }
  });
});
