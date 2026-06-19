import { Queue, type ConnectionOptions, type JobsOptions } from "bullmq";
import { config } from "../config.js";

export const DIGEST_QUEUE_NAME = "email.digest";

export interface DigestJobData {
  userId: string;
  email: string;
  weekStart: string; // YYYY-MM-DD
  weekEnd: string; // YYYY-MM-DD
}

let queue: Queue<DigestJobData> | null = null;

export function getDigestQueue(): Queue<DigestJobData> {
  if (!config.REDIS_URL) throw new Error("REDIS_URL is required for digest queue");
  const connection: ConnectionOptions = { url: config.REDIS_URL, maxRetriesPerRequest: null };
  return (queue ??= new Queue<DigestJobData>(DIGEST_QUEUE_NAME, { connection }));
}

export async function enqueueDigest(data: DigestJobData): Promise<void> {
  const opts: JobsOptions = {
    attempts: 2,
    backoff: { type: "exponential", delay: 60_000 },
    removeOnComplete: true,
    removeOnFail: 50,
  };
  await getDigestQueue().add(DIGEST_QUEUE_NAME, data, opts);
}
