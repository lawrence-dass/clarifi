import { startWorkers } from "./workers/index.js";

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
