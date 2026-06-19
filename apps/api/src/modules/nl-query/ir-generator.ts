import * as z from "zod/v4";
import { QueryIRSchema, type QueryIR } from "@clarifi/shared";
import { config } from "../../config.js";
import { parseStructured, type AnthropicLike } from "../../lib/llm-gateway.js";

// Local Zod v4 mirror of QueryIRSchema — zodOutputFormat requires v4 schemas.
// The result is then re-parsed by the authoritative QueryIRSchema (v3 in shared).
const MetricSchemaV4 = z.enum([
  "total_spend",
  "total_income",
  "net",
  "transaction_count",
  "average_transaction",
]);
const DimensionSchemaV4 = z.enum(["category", "merchant", "month", "account"]);
const FilterSchemaV4 = z.object({
  field: z.enum(["category", "merchant", "account"]),
  op: z.enum(["eq", "in"]),
  value: z.union([z.string(), z.array(z.string()).max(50)]),
});
const TimeRangeSchemaV4 = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
const QueryIRSchemaV4 = z.object({
  metric: MetricSchemaV4,
  dimensions: z.array(DimensionSchemaV4).max(2).default([]),
  filters: z.array(FilterSchemaV4).max(10).default([]),
  timeRange: TimeRangeSchemaV4,
  limit: z.number().int().positive().max(1000).default(100),
  interpretation: z.string().min(1).max(280),
});

const NL_QUERY_SYSTEM_PROMPT = `You are a financial data query assistant for a Canadian personal finance app.

The user will ask a question about their transaction data. Your job is to translate it into
a structured query specification (JSON). Today's date is provided in each message.

## Available metrics (choose exactly one)
- "total_spend"     — sum of expenses (outflows, amount < 0). Use for "how much did I spend".
- "total_income"    — sum of income (inflows, amount > 0). Use for "how much did I earn/receive".
- "net"             — income minus spending. Use for "what is my net" or "savings".
- "transaction_count" — number of transactions. Use for "how many transactions".
- "average_transaction" — average absolute transaction size. Use for "what is my average spend".

## Available dimensions (0–2 group-by fields)
- "category"  — group by spending category
- "merchant"  — group by merchant name
- "month"     — group by calendar month
- "account"   — group by bank account

## Available filter fields
- "category"  — filter by category (values: food_and_dining, transport, housing, utilities,
                  shopping, entertainment, health, travel, income, transfers, other)
- "merchant"  — filter by merchant name (use the normalized name, e.g. "Tim Hortons")
- "account"   — filter by account id

## Filter operators
- "eq"  — equals a single string value
- "in"  — matches any of an array of string values

## Time range
Resolve any relative phrasing ("last month", "this year", "last 6 months", "Q1 2026") into
concrete YYYY-MM-DD dates. The time range is INCLUSIVE on both ends.

## interpretation
Write a single sentence (max 25 words) stating how you interpreted the question. This is
shown to the user verbatim for transparency.

## Rules
- Always produce a valid JSON object matching the schema exactly.
- If the question is ambiguous, use the most reasonable interpretation and describe it.
- Default limit is 10 for dimension queries (the user wants a ranked list), 1 for scalar.
- Never exceed limit 1000.`;

export async function generateQueryIR(
  question: string,
  today: string, // YYYY-MM-DD
  client?: AnthropicLike,
): Promise<QueryIR> {
  // Route through the gateway (single LLM egress point) rather than the SDK directly.
  const parsed = await parseStructured(
    {
      model: config.CATEGORIZATION_MODEL,
      maxTokens: 512,
      system: NL_QUERY_SYSTEM_PROMPT,
      user: `Today is ${today}.\n\nUser question: ${question}`,
      schema: QueryIRSchemaV4,
    },
    client,
  );

  // Authoritative parse against the shared schema (source of truth for the type)
  return QueryIRSchema.parse(parsed);
}
