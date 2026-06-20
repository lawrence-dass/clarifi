/**
 * AST allowlist guard for compiled NL→IR→SQL (CLAUDE.md guardrail).
 *
 * The compiler generates SQL from a constrained, parameterized IR — this
 * validator is defense-in-depth against a compiler bug. Per the guardrail it is
 * an **allowlist over a parsed AST**, not a keyword blocklist: the SQL is parsed
 * with pgsql-ast-parser and every node is checked against positive invariants
 * (single statement, SELECT-only, known table, allowlisted columns + functions,
 * no joins/subqueries/set-operations, mandatory LIMIT). Anything the parser
 * can't parse, or any construct not explicitly permitted, is rejected.
 *
 * Called on every compiled query before execution (on a read-only DB role).
 */
import { parse, type Statement, type From } from "pgsql-ast-parser";

const ALLOWED_TABLE = "transactions";

// Columns the compiler may reference (snake_case, as in the DB).
const ALLOWED_COLUMNS = new Set([
  "amount_cents",
  "category",
  "merchant_name",
  "account_id",
  "date",
  "status",
]);

// Scalar/aggregate functions the compiler may emit. `any` backs `col = ANY($n)`
// for "in" filters; date_trunc/abs/coalesce/sum/count/avg cover the metrics.
const ALLOWED_FUNCTIONS = new Set([
  "coalesce",
  "sum",
  "count",
  "avg",
  "abs",
  "date_trunc",
  "any",
]);

// Set operations are never emitted by the compiler — reject anywhere in the tree.
const FORBIDDEN_SET_OPS = new Set([
  "union",
  "union all",
  "intersect",
  "intersect all",
  "except",
  "except all",
]);

export class SQLValidationError extends Error {
  constructor(reason: string) {
    super(`SQL allowlist violation: ${reason}`);
    this.name = "SQLValidationError";
  }
}

export function validateSQL(sql: string): void {
  let statements: Statement[];
  try {
    statements = parse(sql);
  } catch (e) {
    // Unparseable SQL (e.g. DML/DDL spliced into a clause) is rejected outright.
    throw new SQLValidationError(`unparseable SQL: ${(e as Error).message}`);
  }

  if (statements.length !== 1) {
    throw new SQLValidationError("exactly one statement is allowed");
  }

  const stmt = statements[0]!;
  // A plain `SELECT ... FROM ...` parses to type "select"; UNION/VALUES/WITH/DML
  // parse to other types and are rejected here.
  if (stmt.type !== "select") {
    throw new SQLValidationError(`only SELECT is allowed (got "${stmt.type}")`);
  }

  // Mandatory LIMIT — caps result size on the read-only role.
  if (!stmt.limit || stmt.limit.limit == null) {
    throw new SQLValidationError("LIMIT is required");
  }

  validateFrom(stmt.from);

  // Output aliases (e.g. "value", "category") are valid unqualified refs in
  // ORDER BY / GROUP BY even though they aren't physical columns.
  const aliases = new Set<string>();
  for (const col of stmt.columns ?? []) {
    if (col.alias?.name) aliases.add(col.alias.name.toLowerCase());
  }

  walk(stmt, aliases, true);
}

function validateFrom(from: From[] | undefined | null): void {
  if (!Array.isArray(from) || from.length !== 1) {
    throw new SQLValidationError("exactly one FROM table is required");
  }
  const f = from[0]!;
  if (f.type !== "table" || f.name?.name?.toLowerCase() !== ALLOWED_TABLE) {
    throw new SQLValidationError(`only the "${ALLOWED_TABLE}" table is allowed in FROM`);
  }
  // Joins appear as a `join` descriptor on a FROM entry.
  if ("join" in f && f.join) {
    throw new SQLValidationError("joins are not allowed");
  }
}

// Recursively validate every AST node against the allowlist. The root SELECT is
// permitted; any *nested* select is a subquery and rejected.
function walk(node: unknown, aliases: Set<string>, isRoot = false): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, aliases);
    return;
  }
  if (!node || typeof node !== "object") return;

  const rec = node as Record<string, unknown>;
  const type = typeof rec.type === "string" ? (rec.type as string) : undefined;

  if (type) {
    if (FORBIDDEN_SET_OPS.has(type)) {
      throw new SQLValidationError(`set operations are not allowed (${type})`);
    }
    if (type === "select" && !isRoot) {
      throw new SQLValidationError("subqueries are not allowed");
    }
    if (type === "call") {
      const fn = ((rec.function as { name?: string } | undefined)?.name ?? "").toLowerCase();
      if (!ALLOWED_FUNCTIONS.has(fn)) {
        throw new SQLValidationError(`function not allowed: ${fn || "<unknown>"}`);
      }
    }
    if (type === "ref") {
      const name = String(rec.name ?? "");
      if (name !== "*") {
        const col = name.toLowerCase();
        const qualified = rec.table != null;
        // A qualified ref (t.x) must be a physical column; an unqualified ref may
        // also be an output alias used in ORDER BY / GROUP BY.
        if (!ALLOWED_COLUMNS.has(col) && !(!qualified && aliases.has(col))) {
          throw new SQLValidationError(`column not allowed: ${col || "<unknown>"}`);
        }
      }
    }
  }

  for (const key of Object.keys(rec)) {
    if (key === "type" || key === "_location") continue;
    walk(rec[key], aliases);
  }
}
