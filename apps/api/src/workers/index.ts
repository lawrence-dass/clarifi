import type { Worker } from "bullmq";
import { startCategorizeOutboxDrainer } from "../queues/categorize.outbox.js";
import { startCategorizeReconciler } from "../queues/categorize.reconcile.js";
import { startDemoReaper } from "../queues/demo-reaper.js";
import { startPlaidSyncOutboxDrainer } from "../queues/plaid-sync.outbox.js";
import { createAnomalyExplainWorker } from "./anomaly-explain.worker.js";
import { createCategorizeWorker } from "./categorize.worker.js";
import { createDigestWorker } from "./digest.worker.js";
import { createPlaidSyncWorker } from "./plaid-sync.worker.js";

export interface StartedWorkers {
  close(): Promise<void>;
}

export function startWorkers(): StartedWorkers {
  const workers: Worker[] = [
    createCategorizeWorker(),
    createAnomalyExplainWorker(),
    createPlaidSyncWorker(),
    createDigestWorker(),
  ];
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
  // Durability backstop: re-enqueue categorization for transactions the fast
  // path left stuck at category = null (story 10.1).
  const stopCategorizeReconciler = startCategorizeReconciler();
  // TTL reaper: delete expired demo users end-to-end via the cascade/RLS deletion
  // path (story 12.2). Worker-process only, like every other scheduled sweep.
  const stopDemoReaper = startDemoReaper();
  return {
    async close() {
      stopCategorizeDrainer();
      stopPlaidSyncDrainer();
      stopCategorizeReconciler();
      stopDemoReaper();
      await Promise.all(workers.map((worker) => worker.close()));
    },
  };
}
