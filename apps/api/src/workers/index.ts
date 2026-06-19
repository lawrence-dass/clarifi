import type { Worker } from "bullmq";
import { startCategorizeOutboxDrainer } from "../queues/categorize.outbox.js";
import { startPlaidSyncOutboxDrainer } from "../queues/plaid-sync.outbox.js";
import { createCategorizeWorker } from "./categorize.worker.js";
import { createDigestWorker } from "./digest.worker.js";
import { createPlaidSyncWorker } from "./plaid-sync.worker.js";

export interface StartedWorkers {
  close(): Promise<void>;
}

export function startWorkers(): StartedWorkers {
  const workers: Worker[] = [createCategorizeWorker(), createPlaidSyncWorker(), createDigestWorker()];
  for (const worker of workers) {
    worker.on("error", (err) => {
      // eslint-disable-next-line no-console
      console.error("worker error", { queue: worker.name, message: err.message });
    });
    worker.on("failed", (job, err) => {
      // eslint-disable-next-line no-console
      console.error("worker job failed", { queue: worker.name, jobId: job?.id, message: err.message });
    });
  }

  const stopCategorizeDrainer = startCategorizeOutboxDrainer();
  const stopPlaidSyncDrainer = startPlaidSyncOutboxDrainer();
  return {
    async close() {
      stopCategorizeDrainer();
      stopPlaidSyncDrainer();
      await Promise.all(workers.map((worker) => worker.close()));
    },
  };
}
