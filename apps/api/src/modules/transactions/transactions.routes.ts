import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import {
  getCashFlowSummary,
  getCategoryBreakdown,
  getSpendingTrend,
} from "./transactions.controller.js";

/**
 * Read-only transaction analytics routes, mounted at /transactions beside the
 * ingestion-owned write router. Paths do not overlap: this router owns
 * GET /category-breakdown, GET /spending-trend, and GET /summary; ingestion
 * owns POST /import and PATCH /:id/category.
 */
export const transactionsAnalyticsRouter: Router = Router();

transactionsAnalyticsRouter.get("/category-breakdown", requireAuth, getCategoryBreakdown);
transactionsAnalyticsRouter.get("/spending-trend", requireAuth, getSpendingTrend);
transactionsAnalyticsRouter.get("/summary", requireAuth, getCashFlowSummary);
