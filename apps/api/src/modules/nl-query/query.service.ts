import { serviceUnavailable } from "../../lib/app-error.js";
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

  // The IR generation is the LLM step. If the model is unavailable (down, no
  // key, rate-limited) or returns output we can't use, degrade gracefully to a
  // 503 instead of a raw 500 — the user can retry. The deterministic compile +
  // execute below is not LLM-dependent and keeps its own error handling.
  let ir;
  try {
    ir = await generateQueryIR(req.question, today);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[nl-query] IR generation failed; returning 503:", err);
    throw serviceUnavailable(
      "LLM_UNAVAILABLE",
      "The query assistant is temporarily unavailable. Please try again in a moment.",
    );
  }

  const result = await executeQueryIR(ir, userId);
  return {
    interpretation: result.interpretation,
    rows: result.rows,
    metric: ir.metric,
    dimensions: ir.dimensions,
  };
}
