import { z } from "zod";
import { prisma } from "@clarifi/shared";
import { enqueueCategorize, type CategorizeJobData } from "./categorize.queue.js";

export const CATEGORIZE_REQUESTED_EVENT = "categorization.requested";

const CategorizePayloadSchema = z.object({
  userId: z.string().uuid(),
  accountId: z.string().uuid(),
  holderName: z.string().min(1).nullable().optional(),
});

export async function requestCategorization(data: CategorizeJobData): Promise<void> {
  const payload = toPayload(data);
  const event = await prisma.outbox.create({
    data: {
      eventType: CATEGORIZE_REQUESTED_EVENT,
      payload,
    },
    select: { id: true },
  });

  void dispatchCategorizationEvent(event.id, payload).catch(() => {
    // The outbox row remains unprocessed and will be retried by the worker.
  });
}

export async function drainCategorizeOutbox(limit = 25): Promise<void> {
  const events = await prisma.outbox.findMany({
    where: {
      eventType: CATEGORIZE_REQUESTED_EVENT,
      processed: false,
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, payload: true },
  });

  for (const event of events) {
    const parsed = CategorizePayloadSchema.safeParse(event.payload);
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
      await dispatchCategorizationEvent(event.id, parsed.data);
    } catch {
      await prisma.outbox.update({
        where: { id: event.id },
        data: { attempts: { increment: 1 } },
      });
    }
  }
}

export function startCategorizeOutboxDrainer(intervalMs = 30_000): () => void {
  const timer = setInterval(() => {
    void drainCategorizeOutbox().catch(() => {
      // Keep the worker process alive; the next tick will retry.
    });
  }, intervalMs);
  timer.unref();
  void drainCategorizeOutbox().catch(() => {
    // Initial drain is opportunistic.
  });

  return () => clearInterval(timer);
}

async function dispatchCategorizationEvent(eventId: string, data: CategorizeJobData): Promise<void> {
  await enqueueCategorize(data);
  await prisma.outbox.update({
    where: { id: eventId },
    data: {
      processed: true,
      processedAt: new Date(),
    },
  });
}

function toPayload(data: CategorizeJobData): z.infer<typeof CategorizePayloadSchema> {
  return {
    userId: data.userId,
    accountId: data.accountId,
    ...(data.holderName ? { holderName: data.holderName } : {}),
  };
}
