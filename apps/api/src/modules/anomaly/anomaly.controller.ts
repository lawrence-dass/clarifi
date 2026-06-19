import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { AnomalySeverity } from "@clarifi/shared";
import { badRequest, unauthorized } from "../../lib/app-error.js";
import { listAnomalies, dismissAnomaly, reportAnomaly } from "./anomaly.service.js";

const ListAnomaliesQuery = z.object({
  includeDismissed: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  severity: z.nativeEnum(AnomalySeverity).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().datetime().optional(),
});

export async function getAnomalies(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.userId) throw unauthorized("UNAUTHENTICATED", "Authentication required");

    const parsed = ListAnomaliesQuery.safeParse(req.query);
    if (!parsed.success) {
      throw badRequest("INVALID_PARAMS", "Invalid query parameters", parsed.error.flatten());
    }

    const result = await listAnomalies({
      userId: req.userId,
      includeDismissed: parsed.data.includeDismissed,
      severity: parsed.data.severity,
      limit: parsed.data.limit,
      cursor: parsed.data.cursor,
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function patchDismissAnomaly(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.userId) throw unauthorized("UNAUTHENTICATED", "Authentication required");

    const anomalyId = req.params["id"];
    if (!anomalyId) throw badRequest("MISSING_ID", "Anomaly ID is required");

    await dismissAnomaly({ userId: req.userId, anomalyId });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function patchReportAnomaly(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.userId) throw unauthorized("UNAUTHENTICATED", "Authentication required");

    const anomalyId = req.params["id"];
    if (!anomalyId) throw badRequest("MISSING_ID", "Anomaly ID is required");

    await reportAnomaly({ userId: req.userId, anomalyId });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
