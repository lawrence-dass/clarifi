import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { getBudgets, putBudget } from "./budgets.controller.js";

export const budgetsRouter: Router = Router();

budgetsRouter.put("/", requireAuth, putBudget);
budgetsRouter.get("/", requireAuth, getBudgets);
