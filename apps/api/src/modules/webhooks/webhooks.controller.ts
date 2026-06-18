import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { unauthorized } from "../../lib/app-error.js";
import { requestPlaidSync } from "../../queues/plaid-sync.outbox.js";
import { PlaidJwtWebhookVerifier, type PlaidWebhookVerifier } from "./plaid-webhook-verifier.js";

const PLAID_TRANSACTIONS_WEBHOOK_TYPE = "TRANSACTIONS";
const PLAID_SYNC_UPDATES_AVAILABLE = "SYNC_UPDATES_AVAILABLE";

const PlaidWebhookBody = z.object({
  webhook_type: z.string().min(1),
  webhook_code: z.string().min(1),
  item_id: z.string().min(1).optional(),
});

let activeVerifier: PlaidWebhookVerifier = new PlaidJwtWebhookVerifier();

export function setPlaidWebhookVerifierForTests(verifier: PlaidWebhookVerifier): () => void {
  const previous = activeVerifier;
  activeVerifier = verifier;
  return () => {
    activeVerifier = previous;
  };
}

export async function handlePlaidWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const verified = await activeVerifier.verify({
      verificationHeader: req.header("Plaid-Verification"),
      rawBody: req.rawBody,
    });
    if (!verified) throw unauthorized("INVALID_PLAID_WEBHOOK", "Plaid webhook verification failed");

    const parsed = PlaidWebhookBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(200).json({ ok: true });
      return;
    }

    const { webhook_type: webhookType, webhook_code: webhookCode, item_id: itemId } = parsed.data;
    if (webhookType === PLAID_TRANSACTIONS_WEBHOOK_TYPE && webhookCode === PLAID_SYNC_UPDATES_AVAILABLE && itemId) {
      await requestPlaidSync({ itemId, webhookCode });
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}
