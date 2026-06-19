/**
 * Structural SQL allowlist guard (CLAUDE.md guardrail).
 *
 * The compiler generates SQL from a safe IR — this validator is defense-in-depth
 * against compiler bugs. It verifies the positive invariants (SELECT-only, LIMIT
 * present, single statement, known table) rather than relying solely on a DML
 * keyword blocklist.
 *
 * Called on every compiled query before execution.
 */

const ALLOWED_TABLE = "transactions";

const FORBIDDEN_RE =
  /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|EXEC|EXECUTE|CALL|GRANT|REVOKE|COPY|VACUUM|SET\s+ROLE)\b/i;

export class SQLValidationError extends Error {
  constructor(reason: string) {
    super(`SQL allowlist violation: ${reason}`);
    this.name = "SQLValidationError";
  }
}

export function validateSQL(sql: string): void {
  const trimmed = sql.trim();

  // Must be a SELECT statement
  if (!/^SELECT\b/i.test(trimmed)) {
    throw new SQLValidationError("query must start with SELECT");
  }

  // No DML / DDL / admin keywords anywhere in the query
  if (FORBIDDEN_RE.test(trimmed)) {
    throw new SQLValidationError("forbidden keyword detected");
  }

  // LIMIT is mandatory (caps result set on the read-only role)
  if (!/\bLIMIT\b/i.test(trimmed)) {
    throw new SQLValidationError("LIMIT is required");
  }

  // Single statement only — no semicolons except an optional trailing one
  const withoutTrailingSemi = trimmed.replace(/;\s*$/, "");
  if (/;/.test(withoutTrailingSemi)) {
    throw new SQLValidationError("multiple statements are not allowed");
  }

  // No subqueries or set operations — the compiler never emits these
  const afterSelect = trimmed.slice("SELECT".length);
  if (/\bSELECT\b/i.test(afterSelect)) {
    throw new SQLValidationError("subqueries are not allowed");
  }
  if (/\b(UNION|INTERSECT|EXCEPT)\b/i.test(trimmed)) {
    throw new SQLValidationError("set operations are not allowed");
  }

  // Only the known table may appear in FROM
  const fromMatches = trimmed.match(/\bFROM\s+(\w+)/gi) ?? [];
  for (const match of fromMatches) {
    const tableName = match.replace(/\bFROM\s+/i, "").toLowerCase();
    if (tableName !== ALLOWED_TABLE) {
      throw new SQLValidationError(`unknown table "${tableName}"`);
    }
  }
}
