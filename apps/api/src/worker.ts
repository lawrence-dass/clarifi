import { config } from "./config.js";
import { redisConfigError } from "./queues/categorize.queue.js";
import { startWorkers } from "./workers/index.js";

// Fail loud and refuse to start if Redis isn't configured — otherwise every
// categorize/anomaly/digest job fails silently and the dashboard just looks
// empty (no categories, merchants, or anomalies).
const redisReason = redisConfigError(config.REDIS_URL);
if (redisReason) {
  // eslint-disable-next-line no-console
  console.error(
    [
      "",
      `✖ Cannot start workers: ${redisReason}.`,
      "",
      "  The BullMQ workers (categorization, anomaly detection/explanation,",
      "  digests) need a real Redis over TCP. Set REDIS_URL to the Upstash",
      "  TCP connection string:",
      "",
      "      REDIS_URL=\"rediss://default:<password>@<your-db>.upstash.io:6379\"",
      "",
      "  Note: this is NOT the REST API — UPSTASH_REDIS_REST_URL /",
      "  UPSTASH_REDIS_REST_TOKEN are not used by BullMQ. See .env.example.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

const runtime = startWorkers();

// eslint-disable-next-line no-console
console.log("clarifi-api workers started");

async function shutdown(): Promise<void> {
  await runtime.close();
  process.exit(0);
}

process.once("SIGTERM", () => {
  void shutdown();
});
process.once("SIGINT", () => {
  void shutdown();
});
