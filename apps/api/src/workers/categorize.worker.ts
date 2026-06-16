import { Worker, type Job } from "bullmq";
import {
  Category,
  CategorySource,
  withUserContext,
} from "@clarifi/shared";
import { config } from "../config.js";
import { categorizeBatch, type CategorizeResult } from "../lib/llm-gateway.js";
import {
  CATEGORIZE_QUEUE_NAME,
  getRedisConnectionOptions,
  type CategorizeJobData,
} from "../queues/categorize.queue.js";

export interface CategorizationGateway {
  categorizeBatch(items: { id: string; description: string; holderName?: string | null }[]): Promise<CategorizeResult[]>;
}

const defaultGateway: CategorizationGateway = { categorizeBatch };

export async function processCategorizeJob(
  data: CategorizeJobData,
  options: { gateway?: CategorizationGateway; fallbackOnError?: boolean } = {},
): Promise<void> {
  const gateway = options.gateway ?? defaultGateway;

  while (true) {
    const transactions = await withUserContext(data.userId, (tx) =>
      tx.transaction.findMany({
        where: {
          accountId: data.accountId,
          category: null,
        },
        select: { id: true, rawDescription: true },
        orderBy: { date: "asc" },
        take: config.CATEGORIZE_BATCH_SIZE,
      }),
    );

    if (transactions.length === 0) return;

    let results: CategorizeResult[];
    try {
      results = await gateway.categorizeBatch(
        transactions.map((transaction) => ({
          id: transaction.id,
          description: transaction.rawDescription,
          holderName: data.holderName ?? null,
        })),
      );
    } catch (err) {
      if (!options.fallbackOnError) throw err;
      results = transactions.map((transaction) => ({
        id: transaction.id,
        category: Category.other,
        confidence: 0,
      }));
    }

    const byId = new Map(results.map((result) => [result.id, result]));
    const now = new Date();
    await withUserContext(data.userId, async (tx) => {
      for (const transaction of transactions) {
        const result = byId.get(transaction.id) ?? {
          id: transaction.id,
          category: Category.other,
          confidence: 0,
        };
        await tx.transaction.updateMany({
          where: {
            id: transaction.id,
            accountId: data.accountId,
            category: null,
          },
          data: {
            category: result.category,
            categorySource: CategorySource.llm,
            categoryConfidence: result.confidence,
            categorizedAt: now,
          },
        });
      }
    });
  }
}

export function createCategorizeWorker(): Worker<CategorizeJobData> {
  return new Worker<CategorizeJobData>(
    CATEGORIZE_QUEUE_NAME,
    async (job: Job<CategorizeJobData>) => {
      const maxAttempts = job.opts.attempts ?? 1;
      const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;
      await processCategorizeJob(job.data, { fallbackOnError: isFinalAttempt });
    },
    { connection: getRedisConnectionOptions() },
  );
}
