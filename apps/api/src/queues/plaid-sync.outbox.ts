import { z } from "zod";
import { prisma } from "@clarifi/shared";
import { enqueuePlaidSync } from "./plaid-sync.queue.js";

export const PLAID_SYNC_REQUESTED_EVENT = "plaid.sync_requested";

export const PlaidSyncPayloadSchema = z.object({
  itemId: z.string().min(1),
  webhookCode: z.string().min(1),
});

export type PlaidSyncPayload = z.infer<typeof PlaidSyncPayloadSchema>;

export async function requestPlaidSync(data: PlaidSyncPayload): Promise<void> {
  const payload = PlaidSyncPayloadSchema.parse(data);
  const event = await prisma.outbox.create({
    data: {
      eventType: PLAID_SYNC_REQUESTED_EVENT,
      payload,
    },
    select: { id: true },
  });

  void dispatchPlaidSyncEvent(event.id, payload).catch(() => {
    // The outbox row remains unprocessed and will be retried by the drainer.
  });
}

export async function drainPlaidSyncOutbox(limit = 25): Promise<void> {
  const events = await prisma.outbox.findMany({
    where: {
      eventType: PLAID_SYNC_REQUESTED_EVENT,
      processed: false,
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, payload: true },
  });

  for (const event of events) {
    const parsed = PlaidSyncPayloadSchema.safeParse(event.payload);
    if (!parsed.success) {
      await prisma.outbox.update({
        where: { id: event.id },
        data: {
          processed: true,
          processedAt: new Date(),
          attempts: { increment: 1 },
        },
      });
      continue;
    }

    try {
      await dispatchPlaidSyncEvent(event.id, parsed.data);
    } catch {
      await prisma.outbox.update({
        where: { id: event.id },
        data: { attempts: { increment: 1 } },
      });
    }
  }
}

export function startPlaidSyncOutboxDrainer(intervalMs = 30_000): () => void {
  const timer = setInterval(() => {
    void drainPlaidSyncOutbox().catch(() => {
      // Keep the worker process alive; the next tick will retry.
    });
  }, intervalMs);
  timer.unref();
  void drainPlaidSyncOutbox().catch(() => {
    // Initial drain is opportunistic.
  });

  return () => clearInterval(timer);
}

async function dispatchPlaidSyncEvent(eventId: string, data: PlaidSyncPayload): Promise<void> {
  await enqueuePlaidSync({ itemId: data.itemId, outboxEventId: eventId });
}
