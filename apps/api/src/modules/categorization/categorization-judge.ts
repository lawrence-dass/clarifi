import { Category } from "@clarifi/shared";
import type { CategorizeResult, JudgeVerdict } from "../../lib/llm-gateway.js";

export type JudgeFlagReason = "invalid_category" | "below_confidence";

export interface JudgeFlagLog {
  transactionId: string;
  proposedCategory: Category | string;
  confidence: number;
  reason: JudgeFlagReason;
}

export interface JudgeDisagreementLog {
  transactionId: string;
  proposedCategory: Category;
  suggestedCategory?: Category;
  judgeConfidence: number;
}

export interface ValidatedCategorization {
  result: CategorizeResult;
  flagged: boolean;
  reason?: JudgeFlagReason;
  log?: JudgeFlagLog;
}

export function validateCategorizationResult(
  result: { id: string; category: unknown; confidence: unknown },
  minConfidence: number,
): ValidatedCategorization {
  if (!isCategory(result.category)) {
    return fallback(result, "invalid_category", 0);
  }

  const confidence = typeof result.confidence === "number" && Number.isFinite(result.confidence)
    ? result.confidence
    : 0;
  if (confidence < minConfidence) {
    return fallback(result, "below_confidence", confidence);
  }

  return {
    result: {
      id: result.id,
      category: result.category,
      confidence,
    },
    flagged: false,
  };
}

export function selectResultsForJudge(
  results: CategorizeResult[],
  minConfidence: number,
  reviewCeiling: number,
): CategorizeResult[] {
  return results.filter((result) => result.confidence >= minConfidence && result.confidence < reviewCeiling);
}

export function applyJudgeVerdicts(
  results: CategorizeResult[],
  verdicts: JudgeVerdict[],
): {
  results: CategorizeResult[];
  excludeFromCache: Set<string>;
  disagreements: JudgeDisagreementLog[];
} {
  const verdictById = new Map(verdicts.map((verdict) => [verdict.id, verdict]));
  const excludeFromCache = new Set<string>();
  const disagreements: JudgeDisagreementLog[] = [];

  for (const result of results) {
    const verdict = verdictById.get(result.id);
    if (!verdict || verdict.agree) continue;
    excludeFromCache.add(result.id);
    disagreements.push({
      transactionId: result.id,
      proposedCategory: result.category,
      suggestedCategory: verdict.suggestedCategory,
      judgeConfidence: verdict.confidence,
    });
  }

  return { results, excludeFromCache, disagreements };
}

function fallback(
  result: { id: string; category: unknown; confidence: unknown },
  reason: JudgeFlagReason,
  confidence: number,
): ValidatedCategorization {
  return {
    result: { id: result.id, category: Category.other, confidence: 0 },
    flagged: true,
    reason,
    log: {
      transactionId: result.id,
      proposedCategory: typeof result.category === "string" ? result.category : String(result.category),
      confidence,
      reason,
    },
  };
}

function isCategory(value: unknown): value is Category {
  return typeof value === "string" && Object.values(Category).includes(value as Category);
}
