import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { badRequest, unauthorized } from "../../lib/app-error.js";
import { runNLQuery } from "./query.service.js";

const NLQueryBody = z.object({
  question: z.string().min(1).max(1000),
  today: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export async function postNLQuery(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.userId) throw unauthorized("UNAUTHENTICATED", "Authentication required");

    const parsed = NLQueryBody.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest("INVALID_PARAMS", "Invalid request body", parsed.error.flatten());
    }

    const result = await runNLQuery(req.userId, {
      question: parsed.data.question,
      today: parsed.data.today,
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
