import { describe, expect, it } from "vitest";
import { Category } from "@clarifi/shared";
import {
  applyJudgeVerdicts,
  selectResultsForJudge,
  validateCategorizationResult,
} from "./categorization-judge.js";

describe("categorization judge", () => {
  it("falls back on out-of-enum categories without throwing", () => {
    const validated = validateCategorizationResult(
      { id: "tx1", category: "not_a_category", confidence: 0.92 },
      0.5,
    );

    expect(validated.result).toEqual({ id: "tx1", category: Category.other, confidence: 0 });
    expect(validated.flagged).toBe(true);
    expect(validated.reason).toBe("invalid_category");
    expect(validated.log).toEqual({
      transactionId: "tx1",
      proposedCategory: "not_a_category",
      confidence: 0,
      reason: "invalid_category",
    });
  });

  it("falls back and flags below-floor confidence", () => {
    const validated = validateCategorizationResult(
      { id: "tx1", category: Category.shopping, confidence: 0.49 },
      0.5,
    );

    expect(validated.result).toEqual({ id: "tx1", category: Category.other, confidence: 0 });
    expect(validated.flagged).toBe(true);
    expect(validated.reason).toBe("below_confidence");
    expect(validated.log).toMatchObject({
      transactionId: "tx1",
      proposedCategory: Category.shopping,
      confidence: 0.49,
      reason: "below_confidence",
    });
  });

  it("passes valid above-floor results and selects only review-band results", () => {
    const low = validateCategorizationResult(
      { id: "low", category: Category.food_and_dining, confidence: 0.5 },
      0.5,
    ).result;
    const high = validateCategorizationResult(
      { id: "high", category: Category.shopping, confidence: 0.8 },
      0.5,
    ).result;

    expect(low).toEqual({ id: "low", category: Category.food_and_dining, confidence: 0.5 });
    const fallback = { id: "fallback", category: Category.other, confidence: 0 };
    expect(selectResultsForJudge([fallback, low, high], 0.5, 0.8)).toEqual([low]);
  });

  it("keeps categorizer output on disagreement but excludes that row from cache seeding", () => {
    const results = [
      { id: "tx1", category: Category.food_and_dining, confidence: 0.7 },
      { id: "tx2", category: Category.shopping, confidence: 0.7 },
    ];

    const judged = applyJudgeVerdicts(results, [
      { id: "tx1", agree: true, confidence: 0.9 },
      { id: "tx2", agree: false, suggestedCategory: Category.other, confidence: 0.84 },
    ]);

    expect(judged.results).toBe(results);
    expect(judged.excludeFromCache.has("tx1")).toBe(false);
    expect(judged.excludeFromCache.has("tx2")).toBe(true);
    expect(judged.disagreements).toEqual([
      {
        transactionId: "tx2",
        proposedCategory: Category.shopping,
        suggestedCategory: Category.other,
        judgeConfidence: 0.84,
      },
    ]);
  });
});
