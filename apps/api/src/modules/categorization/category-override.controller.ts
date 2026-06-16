import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { Category } from "@clarifi/shared";
import { badRequest, unauthorized } from "../../lib/app-error.js";
import { overrideTransactionCategory } from "./category-override.service.js";

const OverrideCategoryParams = z.object({
  transactionId: z.string().uuid(),
});

const OverrideCategoryBody = z.object({
  category: z.nativeEnum(Category),
});

export async function overrideCategory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.userId) throw unauthorized("UNAUTHENTICATED", "Authentication required");
    const { transactionId } = OverrideCategoryParams.parse(req.params);
    const { category } = OverrideCategoryBody.parse(req.body);

    const result = await overrideTransactionCategory({
      userId: req.userId,
      transactionId,
      category,
    });
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof z.ZodError && err.issues.some((issue) => issue.path.includes("transactionId"))) {
      next(badRequest("INVALID_TRANSACTION_ID", "Transaction id must be a valid UUID", err.flatten()));
      return;
    }
    next(err);
  }
}
