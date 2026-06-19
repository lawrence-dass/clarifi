import { Prisma } from "@clarifi/shared";
import { detectAnomalies, type DetectionInput } from "./detector.js";

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

  await tx.anomaly.createMany({
    data: anomalies.map((a) => ({
      transactionId: input.transactionId,
      userId: input.userId,
      type: a.type,
      severity: a.severity,
      // explanation: filled asynchronously by story 5.4 (LLM explanation worker)
    })),
  });

  await tx.transaction.update({
    where: { id: input.transactionId },
    data: { isAnomaly: true },
  });
}
