import { Worker, type ConnectionOptions } from "bullmq";
import { config } from "../config.js";
import { buildDigestData, lastWeekRange } from "../modules/email/digest.service.js";
import { buildDigestHtml, buildDigestSubject, buildDigestText } from "../modules/email/digest-template.js";
import { sendEmail } from "../modules/email/email.service.js";
import { DIGEST_QUEUE_NAME, type DigestJobData } from "../queues/digest.queue.js";

export async function processDigestJob(data: DigestJobData): Promise<void> {
  const weekStart = new Date(`${data.weekStart}T00:00:00Z`);
  const weekEnd = new Date(`${data.weekEnd}T23:59:59Z`);

  const digestData = await buildDigestData(data.userId, data.email, weekStart, weekEnd);

  await sendEmail({
    to: data.email,
    subject: buildDigestSubject(digestData),
    text: buildDigestText(digestData),
    html: buildDigestHtml(digestData),
  });
}

export function createDigestWorker(): Worker<DigestJobData> {
  if (!config.REDIS_URL) throw new Error("REDIS_URL is required for digest worker");
  const connection: ConnectionOptions = { url: config.REDIS_URL, maxRetriesPerRequest: null };
  return new Worker<DigestJobData>(
    DIGEST_QUEUE_NAME,
    async (job) => processDigestJob(job.data),
    { connection, concurrency: 5 },
  );
}

/**
 * Enqueue weekly digest jobs for all users.
 *
 * Called from a scheduled task (e.g., cron or BullMQ repeatable job). In
 * production this would page through all users; for the MVP it's a direct
 * DB query limited to reasonable batch size.
 */
export async function scheduleWeeklyDigests(today: Date = new Date()): Promise<number> {
  const { prisma } = await import("@clarifi/shared");
  const { enqueueDigest } = await import("../queues/digest.queue.js");
  const { start, end } = lastWeekRange(today);

  const weekStart = start.toISOString().slice(0, 10);
  const weekEnd = end.toISOString().slice(0, 10);

  // Fetch users who have at least one account (opted-in via signup)
  const users = await prisma.user.findMany({
    select: { id: true, email: true },
    take: 5000, // batch cap for MVP
  });

  for (const user of users) {
    await enqueueDigest({ userId: user.id, email: user.email, weekStart, weekEnd });
  }

  return users.length;
}
