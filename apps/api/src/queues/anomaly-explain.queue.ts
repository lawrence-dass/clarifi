import { Queue, type ConnectionOptions, type JobsOptions } from "bullmq";
import { config } from "../config.js";

export const ANOMALY_EXPLAIN_QUEUE_NAME = "anomaly.explain";

export interface AnomalyExplainJobData {
  anomalyId: string;
}

let queue: Queue<AnomalyExplainJobData> | null = null;

export function getAnomalyExplainQueue(): Queue<AnomalyExplainJobData> {
  if (!config.REDIS_URL) throw new Error("REDIS_URL is required for anomaly explain queue");
  const connection: ConnectionOptions = { url: config.REDIS_URL, maxRetriesPerRequest: null };
  return (queue ??= new Queue<AnomalyExplainJobData>(ANOMALY_EXPLAIN_QUEUE_NAME, { connection }));
}

export async function enqueueAnomalyExplain(data: AnomalyExplainJobData): Promise<void> {
  const opts: JobsOptions = {
    attempts: 3,
    backoff: { type: "exponential", delay: 10_000 },
    removeOnComplete: true,
    removeOnFail: 100,
  };
  await getAnomalyExplainQueue().add(ANOMALY_EXPLAIN_QUEUE_NAME, data, opts);
}
