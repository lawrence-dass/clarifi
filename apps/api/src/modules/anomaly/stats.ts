export const MODIFIED_Z_SCORE_THRESHOLD = 3.5;
export const SHRINKAGE_CONFIDENCE = 5;
export const MIN_SAMPLES = 5;

export interface Baseline {
  median: number;
  mad: number;
  sampleSize: number;
}

// Convert BigInt cents to Number at the query boundary.
// Safe for all realistic personal-finance amounts (< 2^53 cents).
export function centsToNumber(cents: bigint): number {
  return Number(cents);
}

export function computeMedian(values: number[]): number {
  if (values.length === 0) throw new Error("computeMedian: values must be non-empty");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function computeMAD(values: number[], median: number): number {
  if (values.length === 0) return 0;
  const deviations = values.map((v) => Math.abs(v - median));
  return computeMedian(deviations);
}

// Modified z-score: 0.6745 * (value - median) / MAD.
// Returns 0 when MAD = 0 (all values identical — no anomaly signal).
export function modifiedZScore(value: number, median: number, mad: number): number {
  if (mad === 0) return 0;
  return (0.6745 * (value - median)) / mad;
}

// Empirical-Bayes shrinkage: weight observed vs prior by sample size.
// With sampleSize = 0 returns prior; with large sampleSize converges to observed.
export function shrinkTowardsPrior(
  observed: number,
  prior: number,
  sampleSize: number,
  confidence = SHRINKAGE_CONFIDENCE,
): number {
  return (sampleSize * observed + confidence * prior) / (sampleSize + confidence);
}

export function computeBaseline(values: number[]): Baseline {
  const median = computeMedian(values);
  const mad = computeMAD(values, median);
  return { median, mad, sampleSize: values.length };
}
