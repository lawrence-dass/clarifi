import { generateQueryIR } from "./ir-generator.js";
import { executeQueryIR } from "./executor.js";
import type { QueryRow } from "./executor.js";

export interface NLQueryRequest {
  question: string;
  today?: string; // YYYY-MM-DD; defaults to current date
}

export interface NLQueryResponse {
  interpretation: string;
  rows: QueryRow[];
  metric: string;
  dimensions: string[];
}

export async function runNLQuery(
  userId: string,
  req: NLQueryRequest,
): Promise<NLQueryResponse> {
  const today = req.today ?? new Date().toISOString().slice(0, 10);
  const ir = await generateQueryIR(req.question, today);
  const result = await executeQueryIR(ir, userId);
  return {
    interpretation: result.interpretation,
    rows: result.rows,
    metric: ir.metric,
    dimensions: ir.dimensions,
  };
}
