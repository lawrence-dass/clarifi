import { withUserContext } from "@clarifi/shared";
import type { QueryIR } from "@clarifi/shared";
import { compileQueryIR } from "./compiler.js";
import { validateSQL } from "./validator.js";

export interface QueryRow {
  [key: string]: string | number | null;
}

export interface QueryResult {
  rows: QueryRow[];
  interpretation: string;
}

// Normalize values returned by the Postgres driver for JSON serialization.
function normalizeValue(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.toISOString();
  // Prisma may return Decimal objects (AVG of BIGINT → NUMERIC in PG)
  if (typeof v === "object" && "toNumber" in (v as object)) {
    return (v as { toNumber(): number }).toNumber();
  }
  return String(v);
}

function normalizeRow(raw: unknown): QueryRow {
  const row: QueryRow = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    row[k] = normalizeValue(v);
  }
  return row;
}

export async function executeQueryIR(ir: QueryIR, userId: string): Promise<QueryResult> {
  const compiled = compileQueryIR(ir);

  // Defense-in-depth: validate the SQL we generated before sending it to PG
  validateSQL(compiled.sql);

  const rawRows = await withUserContext(userId, async (tx) => {
    // statement_timeout scoped to this transaction only (guardrail: 2 s cap)
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '2000'");
    return tx.$queryRawUnsafe(compiled.sql, ...compiled.params) as Promise<unknown[]>;
  });

  return {
    rows: rawRows.map(normalizeRow),
    interpretation: ir.interpretation,
  };
}
