import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { prisma } from "@clarifi/shared";
import { createApp } from "../../app.js";
import { PLAID_SYNC_REQUESTED_EVENT } from "../../queues/plaid-sync.outbox.js";
import { setPlaidWebhookVerifierForTests } from "./webhooks.controller.js";

vi.mock("../../queues/plaid-sync.queue.js", () => ({
  enqueuePlaidSync: vi.fn(async () => undefined),
}));

const { enqueuePlaidSync } = await import("../../queues/plaid-sync.queue.js");
const mockedEnqueuePlaidSync = vi.mocked(enqueuePlaidSync);

const dbUrl = process.env.DATABASE_URL ?? "";
const hasDb = dbUrl.length > 0 && !dbUrl.includes("placeholder");
const app = createApp();
let restoreVerifier: (() => void) | undefined;

function installVerifier(result: boolean): void {
  restoreVerifier = setPlaidWebhookVerifierForTests({
    async verify() {
      return result;
    },
  });
}

afterEach(async () => {
  restoreVerifier?.();
  restoreVerifier = undefined;
  mockedEnqueuePlaidSync.mockClear();
  if (hasDb) await prisma.outbox.deleteMany({ where: { eventType: PLAID_SYNC_REQUESTED_EVENT } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!hasDb)("POST /webhooks/plaid", () => {
  it("acks valid sync webhooks after writing one durable outbox row and does no sync in-handler", async () => {
    installVerifier(true);

    const res = await request(app)
      .post("/webhooks/plaid")
      .set("Plaid-Verification", "valid.jwt")
      .send({
        webhook_type: "TRANSACTIONS",
        webhook_code: "SYNC_UPDATES_AVAILABLE",
        item_id: "item-webhook-1",
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const rows = await prisma.outbox.findMany({ where: { eventType: PLAID_SYNC_REQUESTED_EVENT } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toEqual({
      itemId: "item-webhook-1",
      webhookCode: "SYNC_UPDATES_AVAILABLE",
    });
    expect(mockedEnqueuePlaidSync).toHaveBeenCalledWith({
      itemId: "item-webhook-1",
      outboxEventId: rows[0]!.id,
    });
  });

  it("rejects unverified webhooks before writing outbox rows", async () => {
    installVerifier(false);

    const res = await request(app)
      .post("/webhooks/plaid")
      .set("Plaid-Verification", "invalid.jwt")
      .send({
        webhook_type: "TRANSACTIONS",
        webhook_code: "SYNC_UPDATES_AVAILABLE",
        item_id: "item-webhook-2",
      });

    expect(res.status).toBe(401);
    expect(await prisma.outbox.count({ where: { eventType: PLAID_SYNC_REQUESTED_EVENT } })).toBe(0);
    expect(mockedEnqueuePlaidSync).not.toHaveBeenCalled();
  });

  it("acks unknown webhook types without side effects", async () => {
    installVerifier(true);

    const res = await request(app)
      .post("/webhooks/plaid")
      .set("Plaid-Verification", "valid.jwt")
      .send({
        webhook_type: "ITEM",
        webhook_code: "ERROR",
        item_id: "item-webhook-3",
      });

    expect(res.status).toBe(200);
    expect(await prisma.outbox.count({ where: { eventType: PLAID_SYNC_REQUESTED_EVENT } })).toBe(0);
    expect(mockedEnqueuePlaidSync).not.toHaveBeenCalled();
  });
});
