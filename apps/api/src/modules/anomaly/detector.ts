import { AnomalySeverity, AnomalyType, Category, Prisma, TransactionStatus } from "@clarifi/shared";
import {
  MIN_SAMPLES,
  MODIFIED_Z_SCORE_THRESHOLD,
  centsToNumber,
  modifiedZScore,
} from "./stats.js";
import { resolveBaseline } from "./baselines.js";

export const VELOCITY_WINDOW_MINUTES = 10;
export const VELOCITY_COUNT_THRESHOLD = 3;

export interface DetectionInput {
  transactionId: string;
  userId: string;
  merchantName: string | null;
  category: Category | null;
  amountCents: bigint;
  occurredAt: Date;
}

export interface DetectedAnomaly {
  type: AnomalyType;
  severity: AnomalySeverity;
  // z-score for merchant type; raw charge count for velocity
  score: number;
}

export async function detectAnomalies(
  input: DetectionInput,
  tx: Prisma.TransactionClient,
): Promise<DetectedAnomaly[]> {
  const results: DetectedAnomaly[] = [];

  const velocity = await checkVelocity(input, tx);
  if (velocity) results.push(velocity);

  const merchant = await checkMerchantAnomaly(input, tx);
  if (merchant) results.push(merchant);

  return results;
}

async function checkVelocity(
  input: DetectionInput,
  tx: Prisma.TransactionClient,
): Promise<DetectedAnomaly | null> {
  if (!input.merchantName) return null;

  const windowStart = new Date(
    input.occurredAt.getTime() - VELOCITY_WINDOW_MINUTES * 60 * 1000,
  );

  const count = await tx.transaction.count({
    where: {
      userId: input.userId,
      merchantName: input.merchantName,
      date: { gte: windowStart, lte: input.occurredAt },
      status: { not: TransactionStatus.removed },
    },
  });

  if (count < VELOCITY_COUNT_THRESHOLD) return null;

  return {
    type: AnomalyType.velocity,
    severity: count >= VELOCITY_COUNT_THRESHOLD + 2 ? AnomalySeverity.critical : AnomalySeverity.warning,
    score: count,
  };
}

// checkMerchantAnomaly flags debit transactions at a new merchant (< MIN_SAMPLES prior
// transactions) whose absolute amount is significantly above the user's category/global
// baseline. Income (amountCents >= 0) is not scored — anomaly detection targets expenses.
async function checkMerchantAnomaly(
  input: DetectionInput,
  tx: Prisma.TransactionClient,
): Promise<DetectedAnomaly | null> {
  if (!input.merchantName) return null;
  if (input.amountCents >= 0n) return null;

  // Count prior (non-current, non-removed) transactions at this merchant.
  const priorCount = await tx.transaction.count({
    where: {
      userId: input.userId,
      merchantName: input.merchantName,
      id: { not: input.transactionId },
      status: { not: TransactionStatus.removed },
    },
  });

  // Merchant anomaly only applies when the merchant is "new" to this user.
  if (priorCount >= MIN_SAMPLES) return null;

  // Use category/global baseline (merchantName: null) — the merchant's own history
  // is too thin to be informative for a new-merchant check.
  const baseline = await resolveBaseline(
    { userId: input.userId, merchantName: null, category: input.category },
    tx,
  );

  // Baselines may be computed on signed (negative) amounts for debit transactions
  // while GLOBAL_PRIOR uses positive magnitudes. Take absolute values for a consistent
  // magnitude comparison across all baseline levels.
  const absAmount = Math.abs(centsToNumber(input.amountCents));
  const absMedian = Math.abs(baseline.median);
  const zScore = modifiedZScore(absAmount, absMedian, baseline.mad);

  if (zScore <= MODIFIED_Z_SCORE_THRESHOLD) return null;

  return {
    type: AnomalyType.merchant,
    severity: classifyZScoreSeverity(zScore),
    score: zScore,
  };
}

// Severity tiers for z-score based anomalies.
// Thresholds are multiples of MODIFIED_Z_SCORE_THRESHOLD (3.5):
//   info    : (3.5, 7]  — unusual but may be intentional
//   warning : (7, 14]   — clearly outside normal range
//   critical: > 14      — extreme outlier; triggers notification in 5.5
export function classifyZScoreSeverity(zScore: number): AnomalySeverity {
  if (zScore > MODIFIED_Z_SCORE_THRESHOLD * 4) return AnomalySeverity.critical;
  if (zScore > MODIFIED_Z_SCORE_THRESHOLD * 2) return AnomalySeverity.warning;
  return AnomalySeverity.info;
}
