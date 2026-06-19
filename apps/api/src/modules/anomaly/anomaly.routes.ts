import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { getAnomalies, patchDismissAnomaly, patchReportAnomaly } from "./anomaly.controller.js";

export const anomaliesRouter: Router = Router();

anomaliesRouter.get("/", requireAuth, getAnomalies);
anomaliesRouter.patch("/:id/dismiss", requireAuth, patchDismissAnomaly);
anomaliesRouter.patch("/:id/report", requireAuth, patchReportAnomaly);
