import { Worker, type Job } from "bullmq";
import {
  AnomalyType,
  prisma,
  TransactionStatus,
  withUserContext,
} from "@clarifi/shared";
import {
  generateAnomalyExplanation,
  type AnomalyExplainInput,
} from "../lib/llm-gateway.js";
import {
  ANOMALY_EXPLAIN_QUEUE_NAME,
  type AnomalyExplainJobData,
} from "../queues/anomaly-explain.queue.js";
import { getRedisConnectionOptions } from "../queues/categorize.queue.js";
import { VELOCITY_WINDOW_MINUTES } from "../modules/anomaly/detector.js";
import { centsToNumber } from "../modules/anomaly/stats.js";

export interface AnomalyExplainGateway {
  generateAnomalyExplanation(input: AnomalyExplainInput): Promise<string>;
}

const defaultGateway: AnomalyExplainGateway = { generateAnomalyExplanation };

export async function processAnomalyExplainJob(
  data: AnomalyExplainJobData,
  gateway: AnomalyExplainGateway = defaultGateway,
): Promise<void> {
  const anomaly = await prisma.anomaly.findUnique({
    where: { id: data.anomalyId },
    select: {
      id: true,
      userId: true,
      type: true,
      explanation: true,
      transaction: {
        select: {
          id: true,
          merchantName: true,
          amountCents: true,
          category: true,
          date: true,
          status: true,
        },
      },
    },
  });

  if (!anomaly || anomaly.explanation !== null) return;

  const { transaction } = anomaly;
  const amountDollars = Math.abs(centsToNumber(transaction.amountCents)) / 100;

  let explanation: string;
  try {
    const input = await buildExplainInput(anomaly.userId, anomaly.type, transaction, amountDollars);
    explanation = await gateway.generateAnomalyExplanation(input);
  } catch {
    explanation = buildTemplatedExplanation(anomaly.type, transaction.merchantName, amountDollars);
  }

  await prisma.anomaly.update({
    where: { id: anomaly.id },
    data: { explanation },
  });
}

async function buildExplainInput(
  userId: string,
  type: AnomalyType,
  transaction: {
    id: string;
    merchantName: string | null;
    amountCents: bigint;
    category: string | null;
    date: Date;
  },
  amountDollars: number,
): Promise<AnomalyExplainInput> {
  const base: AnomalyExplainInput = {
    type,
    amountDollars,
    merchantName: transaction.merchantName,
    category: transaction.category,
  };

  if (type === AnomalyType.velocity && transaction.merchantName) {
    const windowStart = new Date(transaction.date.getTime() - VELOCITY_WINDOW_MINUTES * 60 * 1000);
    const count = await withUserContext(userId, (tx) =>
      tx.transaction.count({
        where: {
          userId,
          merchantName: transaction.merchantName,
          date: { gte: windowStart, lte: transaction.date },
          status: { not: TransactionStatus.removed },
        },
      }),
    );
    return { ...base, velocityCount: count, velocityWindowMinutes: VELOCITY_WINDOW_MINUTES };
  }

  if ((type === AnomalyType.merchant || type === AnomalyType.amount) && transaction.merchantName) {
    const priorCount = await withUserContext(userId, (tx) =>
      tx.transaction.count({
        where: {
          userId,
          merchantName: transaction.merchantName,
          id: { not: transaction.id },
          status: { not: TransactionStatus.removed },
        },
      }),
    );

    // Compute median of prior transactions for context
    const priorAmounts = await withUserContext(userId, (tx) =>
      tx.transaction.findMany({
        where: {
          userId,
          merchantName: transaction.merchantName,
          id: { not: transaction.id },
          status: { not: TransactionStatus.removed },
        },
        select: { amountCents: true },
      }),
    );
    const absAmounts = priorAmounts.map((r) => Math.abs(centsToNumber(r.amountCents)));
    const typicalAmountDollars =
      absAmounts.length > 0
        ? absAmounts.reduce((a, b) => a + b, 0) / absAmounts.length / 100
        : undefined;

    return { ...base, priorTransactionCount: priorCount, typicalAmountDollars };
  }

  return base;
}

// Templated fallback when LLM is unavailable — never blocks the detection result.
function buildTemplatedExplanation(
  type: AnomalyType,
  merchantName: string | null,
  amountDollars: number,
): string {
  const merchant = merchantName ?? "this merchant";
  const amount = `$${amountDollars.toFixed(2)}`;

  switch (type) {
    case AnomalyType.velocity:
      return `Multiple charges at ${merchant} in a short period — this may be a duplicate or fraudulent charge.`;
    case AnomalyType.merchant:
      return `This ${amount} charge at ${merchant} is your first transaction there and is higher than your typical spending.`;
    case AnomalyType.amount:
      return `This ${amount} charge at ${merchant} is significantly higher than your usual amount there.`;
  }
}

export function createAnomalyExplainWorker(): Worker<AnomalyExplainJobData> {
  return new Worker<AnomalyExplainJobData>(
    ANOMALY_EXPLAIN_QUEUE_NAME,
    async (job: Job<AnomalyExplainJobData>) => {
      await processAnomalyExplainJob(job.data);
    },
    { connection: getRedisConnectionOptions() },
  );
}
