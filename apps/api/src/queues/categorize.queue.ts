import { Queue, type JobsOptions, type ConnectionOptions } from "bullmq";
import { config } from "../config.js";

export const CATEGORIZE_QUEUE_NAME = "categorize.transaction";

export interface CategorizeJobData {
  userId: string;
  accountId: string;
  holderName?: string | null;
}

let queue: Queue<CategorizeJobData> | null = null;

export function getRedisConnectionOptions(): ConnectionOptions {
  if (!config.REDIS_URL) throw new Error("REDIS_URL is required for categorization queue");
  if (config.REDIS_URL.includes("dummy-host")) {
    throw new Error("REDIS_URL is not configured for categorization queue");
  }
  return { url: config.REDIS_URL, maxRetriesPerRequest: null };
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
