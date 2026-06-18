import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { badRequest, unauthorized } from "../../lib/app-error.js";
import { createPlaidLinkToken, exchangePlaidPublicToken } from "./accounts.service.js";

const ExchangeBody = z.object({
  publicToken: z.string().min(1).max(512),
});

export async function createLinkToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.userId) throw unauthorized("UNAUTHENTICATED", "Authentication required");
    const linkToken = await createPlaidLinkToken(req.userId);
    res.status(200).json({ linkToken });
  } catch (err) {
    next(err);
  }
}

export async function exchangePublicToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.userId) throw unauthorized("UNAUTHENTICATED", "Authentication required");
    const parsed = ExchangeBody.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest("INVALID_PLAID_EXCHANGE", "Plaid exchange payload is invalid", parsed.error.flatten());
    }

    const accounts = await exchangePlaidPublicToken({
      userId: req.userId,
      publicToken: parsed.data.publicToken,
    });
    res.status(200).json({ accounts });
  } catch (err) {
    next(err);
  }
}
