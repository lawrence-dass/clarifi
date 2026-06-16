import type { Worker } from "bullmq";
import { startCategorizeOutboxDrainer } from "../queues/categorize.outbox.js";
import { createCategorizeWorker } from "./categorize.worker.js";

export interface StartedWorkers {
  close(): Promise<void>;
}

export function startWorkers(): StartedWorkers {
  const workers: Worker[] = [createCategorizeWorker()];
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

  const stopDrainer = startCategorizeOutboxDrainer();
  return {
    async close() {
      stopDrainer();
      await Promise.all(workers.map((worker) => worker.close()));
    },
  };
}
