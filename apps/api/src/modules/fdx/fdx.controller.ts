import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { badRequest, notFound, unauthorized } from "../../lib/app-error.js";
import { listFDXAccounts, listFDXTransactions, getFDXCustomer } from "./fdx.service.js";

const ListTxQuery = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  cursor: z.string().datetime().optional(),
});

export async function getFDXAccounts(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.userId) throw unauthorized("UNAUTHENTICATED", "Authentication required");
    const accounts = await listFDXAccounts(req.userId);
    res.status(200).json({ accounts });
  } catch (err) {
    next(err);
  }
}

export async function getFDXAccountTransactions(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.userId) throw unauthorized("UNAUTHENTICATED", "Authentication required");

    const accountId = req.params["accountId"];
    if (!accountId) throw badRequest("MISSING_ID", "Account ID is required");

    const parsed = ListTxQuery.safeParse(req.query);
    if (!parsed.success) {
      throw badRequest("INVALID_PARAMS", "Invalid query parameters", parsed.error.flatten());
    }

    const result = await listFDXTransactions({
      userId: req.userId,
      accountId,
      limit: parsed.data.limit,
      cursor: parsed.data.cursor,
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getFDXCustomerCurrent(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.userId) throw unauthorized("UNAUTHENTICATED", "Authentication required");

    const customer = await getFDXCustomer(req.userId);
    if (!customer) throw notFound("CUSTOMER_NOT_FOUND", "Customer not found");

    res.status(200).json(customer);
  } catch (err) {
    next(err);
  }
}
