import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@clarifi/shared";
import {
  drainPlaidSyncOutbox,
  PLAID_SYNC_REQUESTED_EVENT,
  requestPlaidSync,
} from "./plaid-sync.outbox.js";

vi.mock("./plaid-sync.queue.js", () => ({
  enqueuePlaidSync: vi.fn(async () => undefined),
}));

const { enqueuePlaidSync } = await import("./plaid-sync.queue.js");
const mockedEnqueuePlaidSync = vi.mocked(enqueuePlaidSync);

const dbUrl = process.env.DATABASE_URL ?? "";
const hasDb = dbUrl.length > 0 && !dbUrl.includes("placeholder");

describe.skipIf(!hasDb)("plaid sync outbox", () => {
  // Clean before and after: these assert exact outbox-row counts, so the table
  // must be free of rows left by a prior run. (Run against an isolated DB —
  // TEST_DATABASE_URL — so a live worker's drainer can't race these.)
  beforeEach(async () => {
    await prisma.outbox.deleteMany({ where: { eventType: PLAID_SYNC_REQUESTED_EVENT } });
  });
  afterEach(async () => {
    await prisma.outbox.deleteMany({ where: { eventType: PLAID_SYNC_REQUESTED_EVENT } });
    mockedEnqueuePlaidSync.mockReset();
  });

  it("leaves a durable unprocessed request when Redis enqueue fails", async () => {
    mockedEnqueuePlaidSync.mockRejectedValueOnce(new Error("redis unavailable"));

    await requestPlaidSync({ itemId: "item-outbox-failure", webhookCode: "SYNC_UPDATES_AVAILABLE" });
    await vi.waitFor(() => expect(mockedEnqueuePlaidSync).toHaveBeenCalledTimes(1));

    const events = await prisma.outbox.findMany({ where: { eventType: PLAID_SYNC_REQUESTED_EVENT } });
    expect(events).toHaveLength(1);
    expect(events[0]?.processed).toBe(false);
    expect(events[0]?.attempts).toBe(0);
  });

  it("increments attempts and leaves the row unprocessed when the drainer cannot enqueue", async () => {
    mockedEnqueuePlaidSync.mockRejectedValueOnce(new Error("redis unavailable"));
    await prisma.outbox.create({
      data: {
        eventType: PLAID_SYNC_REQUESTED_EVENT,
        payload: { itemId: "item-drain-failure", webhookCode: "SYNC_UPDATES_AVAILABLE" },
      },
    });

    await drainPlaidSyncOutbox();

    const event = await prisma.outbox.findFirstOrThrow({ where: { eventType: PLAID_SYNC_REQUESTED_EVENT } });
    expect(event.processed).toBe(false);
    expect(event.attempts).toBe(1);
  });

  it("drains unprocessed Plaid sync requests without marking them processed before worker success", async () => {
    await prisma.outbox.create({
      data: {
        eventType: PLAID_SYNC_REQUESTED_EVENT,
        payload: { itemId: "item-drain-success", webhookCode: "SYNC_UPDATES_AVAILABLE" },
      },
    });

    await drainPlaidSyncOutbox();

    expect(mockedEnqueuePlaidSync).toHaveBeenCalledWith({
      itemId: "item-drain-success",
      outboxEventId: expect.any(String),
    });
    const event = await prisma.outbox.findFirstOrThrow({ where: { eventType: PLAID_SYNC_REQUESTED_EVENT } });
    expect(event.processed).toBe(false);
    expect(event.processedAt).toBeNull();
  });
});
