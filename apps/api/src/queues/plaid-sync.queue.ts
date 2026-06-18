import { Queue, type JobsOptions } from "bullmq";
import { getRedisConnectionOptions } from "./categorize.queue.js";

export const PLAID_SYNC_QUEUE_NAME = "transactions.sync";

export interface PlaidSyncJobData {
  itemId: string;
  outboxEventId?: string;
}

let queue: Queue<PlaidSyncJobData> | null = null;

export function getPlaidSyncQueue(): Queue<PlaidSyncJobData> {
  return (queue ??= new Queue<PlaidSyncJobData>(PLAID_SYNC_QUEUE_NAME, {
    connection: getRedisConnectionOptions(),
  }));
}

export async function enqueuePlaidSync(data: PlaidSyncJobData): Promise<void> {
  const opts: JobsOptions = {
    jobId: data.outboxEventId,
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: true,
    removeOnFail: true,
  };
  await getPlaidSyncQueue().add(PLAID_SYNC_QUEUE_NAME, data, opts);
}
