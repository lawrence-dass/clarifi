import type { QueryIR, Metric, Dimension } from "@clarifi/shared";

export interface CompiledQuery {
  sql: string;
  params: unknown[];
}

// All expressions reference table alias `t` (FROM transactions t).
const METRIC_EXPR: Record<Metric, string> = {
  total_spend:
    "COALESCE(SUM(CASE WHEN t.amount_cents < 0 THEN t.amount_cents ELSE 0 END), 0::bigint)",
  total_income:
    "COALESCE(SUM(CASE WHEN t.amount_cents > 0 THEN t.amount_cents ELSE 0 END), 0::bigint)",
  net: "COALESCE(SUM(t.amount_cents), 0::bigint)",
  transaction_count: "COUNT(*)",
  average_transaction: "COALESCE(AVG(ABS(t.amount_cents))::float8, 0)",
};

// SQL expressions and JSON-key aliases for each dimension.
const DIMENSION_EXPR: Record<Dimension, string> = {
  category: "t.category",
  merchant: "t.merchant_name",
  month: "DATE_TRUNC('month', t.date)",
  account: "t.account_id",
};

const DIMENSION_ALIAS: Record<Dimension, string> = {
  category: "category",
  merchant: "merchant",
  month: "month",
  account: "account",
};

const FILTER_COL: Record<string, string> = {
  category: "t.category",
  merchant: "t.merchant_name",
  account: "t.account_id",
};

export function compileQueryIR(ir: QueryIR): CompiledQuery {
  const params: unknown[] = [];

  function nextParam(val: unknown): string {
    params.push(val);
    return `$${params.length}`;
  }

  // SELECT
  const selectParts: string[] = [];
  for (const dim of ir.dimensions) {
    selectParts.push(`${DIMENSION_EXPR[dim]} AS ${DIMENSION_ALIAS[dim]}`);
  }
  selectParts.push(`${METRIC_EXPR[ir.metric]} AS value`);

  // WHERE — dates and filter values are always parameterized; removed rows excluded
  const whereParts: string[] = [
    `t.date >= ${nextParam(ir.timeRange.start)}::date`,
    `t.date <= ${nextParam(ir.timeRange.end)}::date`,
    `t.status != 'removed'`,
  ];

  for (const filter of ir.filters) {
    const col = FILTER_COL[filter.field]!;
    if (filter.op === "eq") {
      whereParts.push(`${col} = ${nextParam(filter.value)}`);
    } else {
      // "in" — value is an array; use = ANY($n) for parameterized array matching
      whereParts.push(`${col} = ANY(${nextParam(filter.value)})`);
    }
  }

  // GROUP BY
  const groupByExprs = ir.dimensions.map((d) => DIMENSION_EXPR[d]);

  // Embed limit directly — already validated integer ≤ 1000 by Zod, not user-interpolated
  const limitN = ir.limit;

  const lines: string[] = [
    `SELECT ${selectParts.join(", ")}`,
    `FROM transactions t`,
    `WHERE ${whereParts.join(" AND ")}`,
  ];
  if (groupByExprs.length > 0) {
    lines.push(`GROUP BY ${groupByExprs.join(", ")}`);
    lines.push(`ORDER BY value DESC NULLS LAST`);
  }
  lines.push(`LIMIT ${limitN}`);

  return { sql: lines.join("\n"), params };
}
