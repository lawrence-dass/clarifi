import { describe, expect, it, vi } from "vitest";

// Mock every worker/drainer factory so startWorkers() never touches Redis.
const mocks = vi.hoisted(() => {
  const fakeWorker = (name: string) => ({
    name,
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  });
  return {
    createCategorizeWorker: vi.fn(() => fakeWorker("categorize")),
    createAnomalyExplainWorker: vi.fn(() => fakeWorker("anomaly-explain")),
    createPlaidSyncWorker: vi.fn(() => fakeWorker("plaid-sync")),
    createDigestWorker: vi.fn(() => fakeWorker("digest")),
    startCategorizeOutboxDrainer: vi.fn(() => vi.fn()),
    startPlaidSyncOutboxDrainer: vi.fn(() => vi.fn()),
  };
});

vi.mock("./categorize.worker.js", () => ({ createCategorizeWorker: mocks.createCategorizeWorker }));
vi.mock("./anomaly-explain.worker.js", () => ({
  createAnomalyExplainWorker: mocks.createAnomalyExplainWorker,
}));
vi.mock("./plaid-sync.worker.js", () => ({ createPlaidSyncWorker: mocks.createPlaidSyncWorker }));
vi.mock("./digest.worker.js", () => ({ createDigestWorker: mocks.createDigestWorker }));
vi.mock("../queues/categorize.outbox.js", () => ({
  startCategorizeOutboxDrainer: mocks.startCategorizeOutboxDrainer,
}));
vi.mock("../queues/plaid-sync.outbox.js", () => ({
  startPlaidSyncOutboxDrainer: mocks.startPlaidSyncOutboxDrainer,
}));

import { startWorkers } from "./index.js";

describe("startWorkers", () => {
  it("starts all four workers, including the anomaly-explain consumer", async () => {
    const runtime = startWorkers();

    expect(mocks.createCategorizeWorker).toHaveBeenCalledOnce();
    // Regression guard: anomaly-explain jobs are produced by detection
    // (persist.ts) — without this consumer they pile up unprocessed.
    expect(mocks.createAnomalyExplainWorker).toHaveBeenCalledOnce();
    expect(mocks.createPlaidSyncWorker).toHaveBeenCalledOnce();
    expect(mocks.createDigestWorker).toHaveBeenCalledOnce();

    await runtime.close();
  });
});
