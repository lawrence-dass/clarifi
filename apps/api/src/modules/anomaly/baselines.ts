import { Category, Prisma, TransactionStatus } from "@clarifi/shared";
import {
  type Baseline,
  MIN_SAMPLES,
  SHRINKAGE_CONFIDENCE,
  centsToNumber,
  computeBaseline,
  shrinkTowardsPrior,
} from "./stats.js";

export interface ResolvedBaseline {
  level: "merchant" | "category" | "global";
  median: number;
  mad: number;
  sampleSize: number;
}

// Seeded global prior in CAD cents (~$35 median, ~$20 MAD).
// Conservative defaults; real baselines replace these quickly with actual data.
export const GLOBAL_PRIOR: Baseline = { median: 3500, mad: 2000, sampleSize: 0 };

async function loadAmounts(
  where: Prisma.TransactionWhereInput,
  tx: Prisma.TransactionClient,
): Promise<number[]> {
  const rows = await tx.transaction.findMany({
    where: {
      ...where,
      status: { not: TransactionStatus.removed },
    },
    select: { amountCents: true },
  });
  return rows.map((r) => centsToNumber(r.amountCents));
}

export async function resolveBaseline(
  params: { userId: string; merchantName: string | null; category: Category | null },
  tx: Prisma.TransactionClient,
): Promise<ResolvedBaseline> {
  const { userId, merchantName, category } = params;

  // Merchant level
  if (merchantName !== null) {
    const amounts = await loadAmounts({ userId, merchantName }, tx);
    if (amounts.length >= MIN_SAMPLES) {
      const merchantBaseline = computeBaseline(amounts);

      // Shrink merchant towards category prior (or global if category also thin)
      const categoryPrior = await resolveCategoryPrior(userId, category, tx);
      return {
        level: "merchant",
        median: shrinkTowardsPrior(
          merchantBaseline.median,
          categoryPrior.median,
          merchantBaseline.sampleSize,
          SHRINKAGE_CONFIDENCE,
        ),
        mad: shrinkTowardsPrior(
          merchantBaseline.mad,
          categoryPrior.mad,
          merchantBaseline.sampleSize,
          SHRINKAGE_CONFIDENCE,
        ),
        sampleSize: merchantBaseline.sampleSize,
      };
    }
  }

  // Category level
  if (category !== null) {
    const amounts = await loadAmounts({ userId, category }, tx);
    if (amounts.length >= MIN_SAMPLES) {
      const categoryBaseline = computeBaseline(amounts);
      return {
        level: "category",
        median: shrinkTowardsPrior(
          categoryBaseline.median,
          GLOBAL_PRIOR.median,
          categoryBaseline.sampleSize,
          SHRINKAGE_CONFIDENCE,
        ),
        mad: shrinkTowardsPrior(
          categoryBaseline.mad,
          GLOBAL_PRIOR.mad,
          categoryBaseline.sampleSize,
          SHRINKAGE_CONFIDENCE,
        ),
        sampleSize: categoryBaseline.sampleSize,
      };
    }
  }

  // Global prior fallback
  return { level: "global", ...GLOBAL_PRIOR };
}

async function resolveCategoryPrior(
  userId: string,
  category: Category | null,
  tx: Prisma.TransactionClient,
): Promise<Baseline> {
  if (category === null) return GLOBAL_PRIOR;
  const amounts = await loadAmounts({ userId, category }, tx);
  if (amounts.length >= MIN_SAMPLES) return computeBaseline(amounts);
  return GLOBAL_PRIOR;
}
