import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { badRequest, unauthorized } from "../../lib/app-error.js";
import { cashFlowSummary, categoryBreakdown, spendingTrend } from "./transactions.service.js";

const MonthParam = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

const CategoryBreakdownQuery = z.object({
  month: MonthParam,
});

const SpendingTrendQuery = z.object({
  endMonth: MonthParam.optional(),
});

const CashFlowSummaryQuery = z.object({
  month: MonthParam,
});

export async function getCategoryBreakdown(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.userId) throw unauthorized("UNAUTHENTICATED", "Authentication required");

    const parsed = CategoryBreakdownQuery.safeParse(req.query);
    if (!parsed.success) {
      throw badRequest("INVALID_MONTH", "month must use YYYY-MM format", parsed.error.flatten());
    }

    const result = await categoryBreakdown({
      userId: req.userId,
      month: parsed.data.month,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getSpendingTrend(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.userId) throw unauthorized("UNAUTHENTICATED", "Authentication required");

    const parsed = SpendingTrendQuery.safeParse(req.query);
    if (!parsed.success) {
      throw badRequest("INVALID_MONTH", "endMonth must use YYYY-MM format", parsed.error.flatten());
    }

    const result = await spendingTrend({
      userId: req.userId,
      endMonth: parsed.data.endMonth ?? currentUtcMonth(),
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getCashFlowSummary(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.userId) throw unauthorized("UNAUTHENTICATED", "Authentication required");

    const parsed = CashFlowSummaryQuery.safeParse(req.query);
    if (!parsed.success) {
      throw badRequest("INVALID_MONTH", "month must use YYYY-MM format", parsed.error.flatten());
    }

    const result = await cashFlowSummary({
      userId: req.userId,
      month: parsed.data.month,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

function currentUtcMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}
