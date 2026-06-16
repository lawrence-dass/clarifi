import Redis from "ioredis";
import { z } from "zod";
import { Category } from "@clarifi/shared";
import { config } from "../../config.js";
import { merchantNameKey } from "./merchant-normalizer.js";

const CachedMerchantCategorySchema = z.object({
  category: z.nativeEnum(Category),
  confidence: z.number().min(0).max(1).default(1),
});

export interface CachedMerchantCategory {
  category: Category;
  confidence: number;
}

export interface MerchantCategoryCache {
  get(input: { userId: string; merchantName: string }): Promise<CachedMerchantCategory | null>;
  set(input: { userId: string; merchantName: string; category: Category; confidence: number }): Promise<void>;
}

// Entries refresh on every successful categorization; a bounded TTL prevents a stale
// or one-off classification from pinning a merchant forever with no invalidation path.
const MERCHANT_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

let redis: Redis | null = null;

export function merchantCategoryCacheKey(input: { userId: string; merchantName: string }): string {
  return `merchant-category:${input.userId}:${merchantNameKey(input.merchantName)}`;
}

export const redisMerchantCategoryCache: MerchantCategoryCache = {
  async get(input) {
    const raw = await getRedis().get(merchantCategoryCacheKey(input));
    if (!raw) return null;
    return parseCachedMerchantCategory(raw);
  },
  async set(input) {
    const payload = CachedMerchantCategorySchema.parse({
      category: input.category,
      confidence: input.confidence,
    });
    await getRedis().set(
      merchantCategoryCacheKey(input),
      JSON.stringify(payload),
      "EX",
      MERCHANT_CACHE_TTL_SECONDS,
    );
  },
};

export function parseCachedMerchantCategory(raw: string): CachedMerchantCategory | null {
  const parsedJson = safeJsonParse(raw);
  if (!parsedJson.success) return null;
  const parsed = CachedMerchantCategorySchema.safeParse(parsedJson.data);
  return parsed.success ? parsed.data : null;
}

function getRedis(): Redis {
  if (!config.REDIS_URL) throw new Error("REDIS_URL is required for merchant cache");
  if (config.REDIS_URL.includes("dummy-host")) {
    throw new Error("REDIS_URL is not configured for merchant cache");
  }
  // Fail fast so a Redis outage degrades to the LLM path instead of hanging the
  // worker: don't queue commands while offline, and time out any single command.
  return (redis ??= new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    commandTimeout: 1_000,
  }));
}

function safeJsonParse(raw: string): { success: true; data: unknown } | { success: false } {
  try {
    return { success: true, data: JSON.parse(raw) };
  } catch {
    return { success: false };
  }
}
