import { Queue, type JobsOptions, type ConnectionOptions } from "bullmq";
import { config } from "../config.js";

export const CATEGORIZE_QUEUE_NAME = "categorize.transaction";

export interface CategorizeJobData {
  userId: string;
  accountId: string;
  holderName?: string | null;
}

let queue: Queue<CategorizeJobData> | null = null;

/**
 * Pure validator for the Redis connection string. Returns a human-readable
 * reason when REDIS_URL is unusable (missing or still the .env.example
 * placeholder), or null when it looks configured. Used both by the queue
 * accessors and by the worker entrypoint's loud startup check.
 */
export function redisConfigError(redisUrl: string | undefined): string | null {
  if (!redisUrl) return "REDIS_URL is not set";
  if (redisUrl.includes("dummy-host")) {
    return "REDIS_URL is still the .env.example placeholder (dummy-host)";
  }
  return null;
}

export function getRedisConnectionOptions(): ConnectionOptions {
  const reason = redisConfigError(config.REDIS_URL);
  if (reason) throw new Error(`Redis is not configured for the categorization queue: ${reason}`);
  return { url: config.REDIS_URL as string, maxRetriesPerRequest: null };
}

export function getCategorizeQueue(): Queue<CategorizeJobData> {
  return (queue ??= new Queue<CategorizeJobData>(CATEGORIZE_QUEUE_NAME, {
    connection: getRedisConnectionOptions(),
  }));
}

export async function enqueueCategorize(data: CategorizeJobData): Promise<void> {
  const opts: JobsOptions = {
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: true,
    removeOnFail: 100,
  };
  await getCategorizeQueue().add(CATEGORIZE_QUEUE_NAME, data, opts);
}
