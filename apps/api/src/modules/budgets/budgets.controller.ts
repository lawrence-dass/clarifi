import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { Category } from "@clarifi/shared";
import { badRequest, unauthorized } from "../../lib/app-error.js";
import { MonthParam } from "../../lib/month-param.js";
import { budgetsWithProgress, upsertBudget } from "./budgets.service.js";

const JsonSafePositiveInteger = z
  .number()
  .int()
  .positive()
  .refine(Number.isSafeInteger, "monthlyLimitCents must be a JSON-safe integer");

const PutBudgetBody = z.object({
  category: z.nativeEnum(Category),
  month: MonthParam,
  monthlyLimitCents: JsonSafePositiveInteger,
});

const BudgetsQuery = z.object({
  month: MonthParam,
});

export async function putBudget(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.userId) throw unauthorized("UNAUTHENTICATED", "Authentication required");

    const parsed = PutBudgetBody.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest("INVALID_BUDGET", "Budget payload is invalid", parsed.error.flatten());
    }

    const result = await upsertBudget({
      userId: req.userId,
      category: parsed.data.category,
      month: parsed.data.month,
      monthlyLimitCents: parsed.data.monthlyLimitCents,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getBudgets(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.userId) throw unauthorized("UNAUTHENTICATED", "Authentication required");

    const parsed = BudgetsQuery.safeParse(req.query);
    if (!parsed.success) {
      throw badRequest("INVALID_MONTH", "month must use YYYY-MM format", parsed.error.flatten());
    }

    const result = await budgetsWithProgress({
      userId: req.userId,
      month: parsed.data.month,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
