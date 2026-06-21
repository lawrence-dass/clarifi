import { Worker, type Job } from "bullmq";
import {
  Category,
  CategorySource,
  TransactionStatus,
  withUserContext,
} from "@clarifi/shared";
import { detectAndPersist } from "../modules/anomaly/persist.js";
import { config } from "../config.js";
import {
  categorizeBatch,
  judgeCategorizations,
  type CategorizeResult,
  type JudgeVerdict,
} from "../lib/llm-gateway.js";
import {
  redisMerchantCategoryCache,
  type CachedMerchantCategory,
  type MerchantCategoryCache,
} from "../modules/categorization/merchant-cache.js";
import {
  applyJudgeVerdicts,
  selectResultsForJudge,
  validateCategorizationResult,
  type JudgeDisagreementLog,
  type JudgeFlagLog,
} from "../modules/categorization/categorization-judge.js";
import { normalizeMerchantName } from "../modules/categorization/merchant-normalizer.js";
import {
  CATEGORIZE_QUEUE_NAME,
  getRedisConnectionOptions,
  type CategorizeJobData,
} from "../queues/categorize.queue.js";

export interface CategorizationGateway {
  categorizeBatch(items: { id: string; description: string; holderName?: string | null }[]): Promise<CategorizeResult[]>;
}

export interface CategorizationJudge {
  judgeCategorizations(
    items: { id: string; description: string; holderName?: string | null; proposedCategory: Category }[],
  ): Promise<JudgeVerdict[]>;
}

const defaultGateway: CategorizationGateway = { categorizeBatch };
const defaultJudge: CategorizationJudge = { judgeCategorizations };

// Cap the work per transaction at a small, CONSTANT number of rows so a single
// transaction never grows with the batch size — that unbounded growth was what
// blew past Prisma's interactive-transaction timeout (P2028) on a remote DB.
// Each chunk does a handful of writes + anomaly baseline reads, well within
// budget; the timeout is only a safety net, not the mechanism. Chunking also
// isolates failures — a bad chunk doesn't roll back already-committed ones, and
// the job's `category: null` guard makes a retry skip what already landed.
const TX_CHUNK_SIZE = 5;
const CHUNK_TX_OPTIONS = { timeout: 15_000, maxWait: 5_000 } as const;

function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size));
  return groups;
}

export async function processCategorizeJob(
  data: CategorizeJobData,
  options: {
    gateway?: CategorizationGateway;
    judge?: CategorizationJudge;
    merchantCache?: MerchantCategoryCache;
    fallbackOnError?: boolean;
  } = {},
): Promise<void> {
  const gateway = options.gateway ?? defaultGateway;
  const judge = options.judge ?? defaultJudge;
  const merchantCache = options.merchantCache ?? redisMerchantCategoryCache;

  while (true) {
    const transactions = await withUserContext(data.userId, (tx) =>
      tx.transaction.findMany({
        where: {
          accountId: data.accountId,
          category: null,
          status: { not: TransactionStatus.removed },
        },
        select: { id: true, rawDescription: true, amountCents: true, date: true },
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
    for (const group of chunk(cacheHits, TX_CHUNK_SIZE)) {
      await withUserContext(data.userId, async (tx) => {
        for (const transaction of group) {
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
          await safeDetectAndPersist({
            transactionId: transaction.id,
            userId: data.userId,
            merchantName: transaction.merchantName,
            category: transaction.cached.category,
            amountCents: transaction.amountCents,
            occurredAt: transaction.date,
          }, tx);
        }
      }, CHUNK_TX_OPTIONS);
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

    const excludeFromCache = new Set<string>();
    if (!fallbackUsed) {
      const judged = await validateAndJudgeResults(results, cacheMisses, data, judge);
      results = judged.results;
      for (const id of judged.excludeFromCache) excludeFromCache.add(id);
    }

    const byId = new Map(results.map((result) => [result.id, result]));
    const cacheWrites: Array<{
      userId: string;
      merchantName: string;
      category: Category;
      confidence: number;
    }> = [];
    for (const group of chunk(cacheMisses, TX_CHUNK_SIZE)) {
      await withUserContext(data.userId, async (tx) => {
        for (const transaction of group) {
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
          await safeDetectAndPersist({
            transactionId: transaction.id,
            userId: data.userId,
            merchantName: transaction.merchantName,
            category: result.category,
            amountCents: transaction.amountCents,
            occurredAt: transaction.date,
          }, tx);
          if (
            transaction.merchantName &&
            !fallbackUsed &&
            !excludeFromCache.has(transaction.id) &&
            isCacheableResult(result)
          ) {
            cacheWrites.push({
              userId: data.userId,
              merchantName: transaction.merchantName,
              category: result.category,
              confidence: result.confidence,
            });
          }
        }
      }, CHUNK_TX_OPTIONS);
    }

    for (const cacheWrite of cacheWrites) {
      await safeSetCachedMerchant(merchantCache, cacheWrite);
    }
  }
}

async function validateAndJudgeResults(
  results: CategorizeResult[],
  transactions: Array<{ id: string; rawDescription: string }>,
  data: CategorizeJobData,
  judge: CategorizationJudge,
): Promise<{ results: CategorizeResult[]; excludeFromCache: Set<string> }> {
  const validatedResults: CategorizeResult[] = [];
  const excludeFromCache = new Set<string>();
  const flagLogs: JudgeFlagLog[] = [];

  for (const result of results) {
    const validated = validateCategorizationResult(result, config.CATEGORIZE_JUDGE_MIN_CONFIDENCE);
    validatedResults.push(validated.result);
    if (validated.flagged) {
      excludeFromCache.add(validated.result.id);
      if (validated.log) flagLogs.push(validated.log);
    }
  }

  for (const log of flagLogs) logJudgeFlag(log);

  if (!config.CATEGORIZE_JUDGE_ENABLED) {
    return { results: validatedResults, excludeFromCache };
  }

  const inBandResults = selectResultsForJudge(
    validatedResults,
    config.CATEGORIZE_JUDGE_MIN_CONFIDENCE,
    config.CATEGORIZE_JUDGE_REVIEW_CEILING,
  );
  if (inBandResults.length === 0) return { results: validatedResults, excludeFromCache };

  const transactionById = new Map(transactions.map((transaction) => [transaction.id, transaction]));
  try {
    const verdicts = await judge.judgeCategorizations(
      inBandResults.map((result) => {
        const transaction = transactionById.get(result.id);
        return {
          id: result.id,
          description: transaction?.rawDescription ?? "",
          holderName: data.holderName ?? null,
          proposedCategory: result.category,
        };
      }),
    );
    const judged = applyJudgeVerdicts(validatedResults, verdicts);
    for (const id of judged.excludeFromCache) excludeFromCache.add(id);
    for (const disagreement of judged.disagreements) logJudgeDisagreement(disagreement);
    return { results: judged.results, excludeFromCache };
  } catch {
    warnJudgeDegraded();
    return { results: validatedResults, excludeFromCache };
  }
}

// Detection failure must never block categorization — anomaly detection is best-effort.
async function safeDetectAndPersist(
  input: Parameters<typeof detectAndPersist>[0],
  tx: Parameters<typeof detectAndPersist>[1],
): Promise<void> {
  try {
    await detectAndPersist(input, tx);
  } catch (err) {
    console.warn("[categorize] anomaly detection failed, skipping:", err);
  }
}

// Don't seed the cache from weak signals: an `other` or low-confidence result would
// pin a merchant to a bad category for every future transaction. Let those re-hit the
// LLM until a confident answer is produced.
function isCacheableResult(result: { category: Category; confidence: number }): boolean {
  return result.category !== Category.other && result.confidence >= config.CATEGORIZE_JUDGE_MIN_CONFIDENCE;
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

let lastJudgeWarnAt = 0;
function warnJudgeDegraded(): void {
  const now = Date.now();
  if (now - lastJudgeWarnAt > 60_000) {
    lastJudgeWarnAt = now;
    console.warn("[categorize] categorization judge unavailable — proceeding without judge validation");
  }
}

function logJudgeFlag(record: JudgeFlagLog): void {
  console.warn("[categorize] categorization result flagged", record);
}

function logJudgeDisagreement(record: JudgeDisagreementLog): void {
  console.warn("[categorize] categorization judge disagreed", record);
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
