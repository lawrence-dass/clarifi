import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@clarifi/shared";
import {
  CATEGORIZE_REQUESTED_EVENT,
  drainCategorizeOutbox,
  requestCategorization,
} from "./categorize.outbox.js";

vi.mock("./categorize.queue.js", () => ({
  enqueueCategorize: vi.fn(async () => undefined),
}));

const { enqueueCategorize } = await import("./categorize.queue.js");
const mockedEnqueue = vi.mocked(enqueueCategorize);

const dbUrl = process.env.DATABASE_URL ?? "";
const hasDb = dbUrl.length > 0 && !dbUrl.includes("placeholder");

describe.skipIf(!hasDb)("categorize outbox", () => {
  // Clean both before and after: these assert exact outbox-row counts, so the
  // table must be free of rows left by prior runs or real app/script usage
  // (the same DB is shared), not just cleaned up afterward.
  beforeEach(async () => {
    await prisma.outbox.deleteMany({ where: { eventType: CATEGORIZE_REQUESTED_EVENT } });
  });
  afterEach(async () => {
    await prisma.outbox.deleteMany({ where: { eventType: CATEGORIZE_REQUESTED_EVENT } });
    mockedEnqueue.mockReset();
  });

  it("leaves a durable unprocessed request when Redis enqueue fails", async () => {
    mockedEnqueue.mockRejectedValueOnce(new Error("redis unavailable"));

    await requestCategorization({ userId: randomUUID(), accountId: randomUUID() });
    await vi.waitFor(() => expect(mockedEnqueue).toHaveBeenCalledTimes(1));

    const events = await prisma.outbox.findMany({ where: { eventType: CATEGORIZE_REQUESTED_EVENT } });
    expect(events).toHaveLength(1);
    expect(events[0]?.processed).toBe(false);
  });

  it("drains unprocessed categorization requests", async () => {
    const payload = { userId: randomUUID(), accountId: randomUUID() };
    await prisma.outbox.create({
      data: {
        eventType: CATEGORIZE_REQUESTED_EVENT,
        payload,
      },
    });

    await drainCategorizeOutbox();

    expect(mockedEnqueue).toHaveBeenCalledWith(payload);
    const event = await prisma.outbox.findFirstOrThrow({
      where: { eventType: CATEGORIZE_REQUESTED_EVENT },
    });
    expect(event.processed).toBe(true);
    expect(event.processedAt).toBeInstanceOf(Date);
  });
});
