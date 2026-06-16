import { Category, CategorySource, withUserContext } from "@clarifi/shared";
import { notFound } from "../../lib/app-error.js";
import {
  redisMerchantCategoryCache,
  type MerchantCategoryCache,
} from "./merchant-cache.js";
import { normalizeMerchantName } from "./merchant-normalizer.js";

export interface OverrideCategoryResult {
  id: string;
  category: Category;
  categorySource: CategorySource;
  categoryConfidence: number;
  categorizedAt: Date;
  merchantName: string | null;
}

export async function overrideTransactionCategory(input: {
  userId: string;
  transactionId: string;
  category: Category;
  merchantCache?: MerchantCategoryCache;
}): Promise<OverrideCategoryResult> {
  const merchantCache = input.merchantCache ?? redisMerchantCategoryCache;
  const categorizedAt = new Date();
  const result = await withUserContext(input.userId, async (tx) => {
    const transaction = await tx.transaction.findUnique({
      where: { id: input.transactionId },
      select: {
        id: true,
        rawDescription: true,
      },
    });
    if (!transaction) throw notFound("TRANSACTION_NOT_FOUND", "Transaction not found");

    const merchantName = normalizeMerchantName(transaction.rawDescription);
    return tx.transaction.update({
      where: { id: transaction.id },
      data: {
        merchantName,
        category: input.category,
        categorySource: CategorySource.user,
        categoryConfidence: 1,
        categorizedAt,
      },
      select: {
        id: true,
        category: true,
        categorySource: true,
        categoryConfidence: true,
        categorizedAt: true,
        merchantName: true,
      },
    });
  });

  if (result.merchantName) {
    await safeSeedMerchantCache(merchantCache, {
      userId: input.userId,
      merchantName: result.merchantName,
      category: input.category,
    });
  }

  return {
    id: result.id,
    category: result.category!,
    categorySource: result.categorySource!,
    categoryConfidence: result.categoryConfidence!,
    categorizedAt: result.categorizedAt!,
    merchantName: result.merchantName,
  };
}

async function safeSeedMerchantCache(
  cache: MerchantCategoryCache,
  input: { userId: string; merchantName: string; category: Category },
): Promise<void> {
  try {
    await cache.set({
      userId: input.userId,
      merchantName: input.merchantName,
      category: input.category,
      confidence: 1,
    });
  } catch {
    // The user's correction is already durable; cache learning must not make the
    // override endpoint fail when Redis is unavailable.
  }
}
