import { Worker, type Job } from "bullmq";
import {
  Category,
  CategorySource,
  withUserContext,
} from "@clarifi/shared";
import { config } from "../config.js";
import { categorizeBatch, type CategorizeResult } from "../lib/llm-gateway.js";
import {
  redisMerchantCategoryCache,
  type CachedMerchantCategory,
  type MerchantCategoryCache,
} from "../modules/categorization/merchant-cache.js";
import { normalizeMerchantName } from "../modules/categorization/merchant-normalizer.js";
import {
  CATEGORIZE_QUEUE_NAME,
  getRedisConnectionOptions,
  type CategorizeJobData,
} from "../queues/categorize.queue.js";

export interface CategorizationGateway {
  categorizeBatch(items: { id: string; description: string; holderName?: string | null }[]): Promise<CategorizeResult[]>;
}

const defaultGateway: CategorizationGateway = { categorizeBatch };

export async function processCategorizeJob(
  data: CategorizeJobData,
  options: {
    gateway?: CategorizationGateway;
    merchantCache?: MerchantCategoryCache;
    fallbackOnError?: boolean;
  } = {},
): Promise<void> {
  const gateway = options.gateway ?? defaultGateway;
  const merchantCache = options.merchantCache ?? redisMerchantCategoryCache;

  while (true) {
    const transactions = await withUserContext(data.userId, (tx) =>
      tx.transaction.findMany({
        where: {
          accountId: data.accountId,
          category: null,
        },
        select: { id: true, rawDescription: true },
        orderBy: { date: "asc" },
        take: config.CATEGORIZE_BATCH_SIZE,
      }),
    );

    if (transactions.length === 0) return;

    const candidates = await Promise.all(
      transactions.map(async (transaction) => {
        const merchantName = normalizeMerchantName(transaction.rawDescription, {
          holderName: data.holderName,
        });
        const cached = merchantName ? await safeGetCachedMerchant(merchantCache, {
          userId: data.userId,
          merchantName,
        }) : null;
        return { ...transaction, merchantName, cached };
      }),
    );
    const cacheHits = candidates.filter(
      (candidate): candidate is typeof candidate & { merchantName: string; cached: CachedMerchantCategory } =>
        Boolean(candidate.merchantName && candidate.cached),
    );
    const cacheMisses = candidates.filter((candidate) => !candidate.cached);

    const now = new Date();
    if (cacheHits.length > 0) {
      await withUserContext(data.userId, async (tx) => {
        for (const transaction of cacheHits) {
          await tx.transaction.updateMany({
            where: {
              id: transaction.id,
              accountId: data.accountId,
              category: null,
            },
            data: {
              merchantName: transaction.merchantName,
              category: transaction.cached.category,
              categorySource: CategorySource.merchant_cache,
              categoryConfidence: transaction.cached.confidence,
              categorizedAt: now,
            },
          });
        }
      });
    }

    if (cacheMisses.length === 0) continue;

    let results: CategorizeResult[];
    let fallbackUsed = false;
    try {
      results = await gateway.categorizeBatch(
        cacheMisses.map((transaction) => ({
          id: transaction.id,
          description: transaction.rawDescription,
          holderName: data.holderName ?? null,
        })),
      );
    } catch (err) {
      if (!options.fallbackOnError) throw err;
      fallbackUsed = true;
      results = cacheMisses.map((transaction) => ({
        id: transaction.id,
        category: Category.other,
        confidence: 0,
      }));
    }

    const byId = new Map(results.map((result) => [result.id, result]));
    const cacheWrites: Array<{
      userId: string;
      merchantName: string;
      category: Category;
      confidence: number;
    }> = [];
    await withUserContext(data.userId, async (tx) => {
      for (const transaction of cacheMisses) {
        const result = byId.get(transaction.id) ?? {
          id: transaction.id,
          category: Category.other,
          confidence: 0,
        };
        await tx.transaction.updateMany({
          where: {
            id: transaction.id,
            accountId: data.accountId,
            category: null,
          },
          data: {
            merchantName: transaction.merchantName,
            category: result.category,
            categorySource: CategorySource.llm,
            categoryConfidence: result.confidence,
            categorizedAt: now,
          },
        });
        if (transaction.merchantName && !fallbackUsed && isCacheableResult(result)) {
          cacheWrites.push({
            userId: data.userId,
            merchantName: transaction.merchantName,
            category: result.category,
            confidence: result.confidence,
          });
        }
      }
    });

    for (const cacheWrite of cacheWrites) {
      await safeSetCachedMerchant(merchantCache, cacheWrite);
    }
  }
}

// Don't seed the cache from weak signals: an `other` or low-confidence result would
// pin a merchant to a bad category for every future transaction. Let those re-hit the
// LLM until a confident answer is produced.
const MERCHANT_CACHE_MIN_CONFIDENCE = 0.5;

function isCacheableResult(result: { category: Category; confidence: number }): boolean {
  return result.category !== Category.other && result.confidence >= MERCHANT_CACHE_MIN_CONFIDENCE;
}

// Surface cache degradation without leaking PII (no keys/descriptions) and without
// spamming: a silent fallback to the LLM on every row hides a misconfigured Redis.
let lastCacheWarnAt = 0;
function warnCacheDegraded(): void {
  const now = Date.now();
  if (now - lastCacheWarnAt > 60_000) {
    lastCacheWarnAt = now;
    console.warn("[categorize] merchant cache unavailable — degrading to LLM categorization");
  }
}

async function safeGetCachedMerchant(
  cache: MerchantCategoryCache,
  input: { userId: string; merchantName: string },
): Promise<CachedMerchantCategory | null> {
  try {
    return await cache.get(input);
  } catch {
    warnCacheDegraded();
    return null;
  }
}

async function safeSetCachedMerchant(
  cache: MerchantCategoryCache,
  input: { userId: string; merchantName: string; category: Category; confidence: number },
): Promise<void> {
  try {
    await cache.set(input);
  } catch {
    // Cache write failures must not block categorization.
    warnCacheDegraded();
  }
}

export function createCategorizeWorker(): Worker<CategorizeJobData> {
  return new Worker<CategorizeJobData>(
    CATEGORIZE_QUEUE_NAME,
    async (job: Job<CategorizeJobData>) => {
      const maxAttempts = job.opts.attempts ?? 1;
      const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;
      await processCategorizeJob(job.data, { fallbackOnError: isFinalAttempt });
    },
    { connection: getRedisConnectionOptions() },
  );
}
