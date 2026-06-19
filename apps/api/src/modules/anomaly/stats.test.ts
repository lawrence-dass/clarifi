import { describe, expect, it } from "vitest";
import {
  computeBaseline,
  computeMAD,
  computeMedian,
  centsToNumber,
  modifiedZScore,
  shrinkTowardsPrior,
  MODIFIED_Z_SCORE_THRESHOLD,
  SHRINKAGE_CONFIDENCE,
} from "./stats.js";

describe("computeMedian", () => {
  it("throws on empty array", () => {
    expect(() => computeMedian([])).toThrow("non-empty");
  });

  it("returns the single element for a one-element array", () => {
    expect(computeMedian([42])).toBe(42);
  });

  it("returns the middle value for odd-length arrays", () => {
    expect(computeMedian([3, 1, 4, 1, 5])).toBe(3);
  });

  it("returns the average of two middle values for even-length arrays", () => {
    expect(computeMedian([1, 2, 3, 4])).toBe(2.5);
  });

  it("sorts the input before computing (does not mutate the original)", () => {
    const input = [5, 3, 1, 4, 2];
    expect(computeMedian(input)).toBe(3);
    expect(input).toEqual([5, 3, 1, 4, 2]); // not mutated
  });

  it("handles negative values", () => {
    expect(computeMedian([-10, -5, 0, 5, 10])).toBe(0);
  });
});

describe("computeMAD", () => {
  it("returns 0 for empty array", () => {
    expect(computeMAD([], 0)).toBe(0);
  });

  it("returns 0 when all values are identical (MAD=0 edge case)", () => {
    expect(computeMAD([5, 5, 5, 5], 5)).toBe(0);
  });

  it("computes MAD correctly for a known dataset", () => {
    // values: [1, 1, 2, 2, 4, 6, 9] median = 2
    // deviations: [1, 1, 0, 0, 2, 4, 7] median of deviations = 1
    expect(computeMAD([1, 1, 2, 2, 4, 6, 9], 2)).toBe(1);
  });

  it("handles negative values", () => {
    // values: [-3, -1, 0, 1, 3], median = 0
    // deviations: [3, 1, 0, 1, 3], median = 1
    expect(computeMAD([-3, -1, 0, 1, 3], 0)).toBe(1);
  });
});

describe("modifiedZScore", () => {
  it("returns 0 when MAD is 0", () => {
    expect(modifiedZScore(100, 50, 0)).toBe(0);
  });

  it("returns a positive score for values above median", () => {
    const score = modifiedZScore(100, 50, 10);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeCloseTo((0.6745 * 50) / 10);
  });

  it("returns a negative score for values below median", () => {
    const score = modifiedZScore(10, 50, 10);
    expect(score).toBeLessThan(0);
  });

  it("scores above MODIFIED_Z_SCORE_THRESHOLD for clear outliers", () => {
    // value = 1000, median = 50, mad = 10 → score ≈ 64.6
    const score = modifiedZScore(1000, 50, 10);
    expect(score).toBeGreaterThan(MODIFIED_Z_SCORE_THRESHOLD);
  });

  it("scores below MODIFIED_Z_SCORE_THRESHOLD for typical variation", () => {
    // value = 60, median = 50, mad = 10 → score ≈ 0.67
    const score = modifiedZScore(60, 50, 10);
    expect(score).toBeLessThan(MODIFIED_Z_SCORE_THRESHOLD);
  });
});

describe("shrinkTowardsPrior", () => {
  it("returns the prior when sampleSize is 0", () => {
    expect(shrinkTowardsPrior(1000, 3500, 0)).toBe(3500);
  });

  it("converges toward observed as sampleSize grows large", () => {
    // sampleSize=10000, confidence=5 → weight on prior is tiny (5/10005)
    const result = shrinkTowardsPrior(1000, 3500, 10000);
    expect(result).toBeGreaterThan(999);
    expect(result).toBeLessThan(1002);
  });

  it("gives equal weight at sampleSize == confidence", () => {
    const result = shrinkTowardsPrior(0, 100, SHRINKAGE_CONFIDENCE);
    expect(result).toBe(50); // (5*0 + 5*100) / (5+5) = 50
  });

  it("respects a custom confidence parameter", () => {
    // confidence=10, sampleSize=10, observed=0, prior=100 → (0 + 1000) / 20 = 50
    expect(shrinkTowardsPrior(0, 100, 10, 10)).toBe(50);
  });
});

describe("centsToNumber", () => {
  it("converts a positive BigInt to a Number", () => {
    expect(centsToNumber(100n)).toBe(100);
  });

  it("converts a negative BigInt to a Number", () => {
    expect(centsToNumber(-4999n)).toBe(-4999);
  });

  it("converts zero", () => {
    expect(centsToNumber(0n)).toBe(0);
  });

  it("handles large but safe values (< 2^53)", () => {
    const largeCents = BigInt(Number.MAX_SAFE_INTEGER);
    expect(centsToNumber(largeCents)).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("computeBaseline", () => {
  it("returns correct median, MAD, and sampleSize", () => {
    const values = [10, 20, 30, 40, 50];
    const baseline = computeBaseline(values);
    expect(baseline.median).toBe(30);
    expect(baseline.sampleSize).toBe(5);
    // deviations from 30: [20, 10, 0, 10, 20] → median = 10
    expect(baseline.mad).toBe(10);
  });

  it("returns MAD=0 when all values are identical", () => {
    const baseline = computeBaseline([500, 500, 500]);
    expect(baseline.median).toBe(500);
    expect(baseline.mad).toBe(0);
  });
});
