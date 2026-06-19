import { Prisma } from "@clarifi/shared";
import { detectAnomalies, type DetectionInput } from "./detector.js";
import { enqueueAnomalyExplain } from "../../queues/anomaly-explain.queue.js";

// detectAndPersist runs all anomaly checks for one transaction and, if any are
// found, writes Anomaly rows and marks the transaction as anomalous.
// Caller is responsible for providing a tx from withUserContext — this function
// never opens its own context (RLS is enforced by the caller's session variable).
export async function detectAndPersist(
  input: DetectionInput,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const anomalies = await detectAnomalies(input, tx);
  if (anomalies.length === 0) return;

  // Create each Anomaly row individually so we capture the generated IDs for the
  // async explanation queue. createMany does not return created records.
  const anomalyIds: string[] = [];
  for (const a of anomalies) {
    const row = await tx.anomaly.create({
      data: {
        transactionId: input.transactionId,
        userId: input.userId,
        type: a.type,
        severity: a.severity,
        // explanation: filled asynchronously by story 5.4 (LLM explanation worker)
      },
      select: { id: true },
    });
    anomalyIds.push(row.id);
  }

  await tx.transaction.update({
    where: { id: input.transactionId },
    data: { isAnomaly: true },
  });

  // Enqueue async LLM explanation jobs (best-effort — never blocks detection).
  // Jobs run after the DB transaction commits; explanation is null until fulfilled.
  for (const anomalyId of anomalyIds) {
    await safeEnqueueExplanation(anomalyId);
  }
}

async function safeEnqueueExplanation(anomalyId: string): Promise<void> {
  try {
    await enqueueAnomalyExplain({ anomalyId });
  } catch {
    // Redis unavailable — explanation will remain null; templated fallback shown in UI.
  }
}
