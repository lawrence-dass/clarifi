import { z } from "zod";

/**
 * NL-query Intermediate Representation (semantic layer).
 *
 * Guardrail (CLAUDE.md): the LLM does NOT write SQL. It produces this constrained,
 * validated query spec; deterministic application code compiles it into
 * parameterized SQL executed under RLS on a read-only role. This is what makes
 * the AI data interface safe and keeps wrong answers visible rather than silent.
 *
 * Any IR that fails this schema is rejected before a single byte of SQL is built.
 */

export const MetricSchema = z.enum([
  "total_spend", // sum of outflows
  "total_income", // sum of inflows
  "net", // income - spend
  "transaction_count",
  "average_transaction",
]);

export const DimensionSchema = z.enum([
  "category",
  "merchant",
  "month",
  "account",
]);

export const TimeRangeSchema = z.object({
  // Inclusive ISO dates (YYYY-MM-DD). The compiler resolves relative phrasing
  // ("last month") into concrete dates before producing the IR.
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const FilterSchema = z.object({
  field: z.enum(["category", "merchant", "account"]),
  op: z.enum(["eq", "in"]),
  value: z.union([z.string(), z.array(z.string()).max(50)]),
});

export const QueryIRSchema = z
  .object({
    metric: MetricSchema,
    // Group-by dimensions (optional). Empty = a single scalar answer.
    dimensions: z.array(DimensionSchema).max(2).default([]),
    filters: z.array(FilterSchema).max(10).default([]),
    timeRange: TimeRangeSchema,
    // Mandatory bound — the compiler also enforces a hard cap.
    limit: z.number().int().positive().max(1000).default(100),
    // The human-readable interpretation echoed back to the user (transparency).
    interpretation: z.string().min(1).max(280),
  })
  .strict();

export type QueryIR = z.infer<typeof QueryIRSchema>;
export type Metric = z.infer<typeof MetricSchema>;
export type Dimension = z.infer<typeof DimensionSchema>;
