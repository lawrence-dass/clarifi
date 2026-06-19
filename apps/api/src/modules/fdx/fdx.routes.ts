import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import {
  getFDXAccounts,
  getFDXAccountTransactions,
  getFDXCustomerCurrent,
} from "./fdx.controller.js";

export const fdxRouter: Router = Router();

fdxRouter.get("/accounts", requireAuth, getFDXAccounts);
fdxRouter.get("/accounts/:accountId/transactions", requireAuth, getFDXAccountTransactions);
fdxRouter.get("/customers/current", requireAuth, getFDXCustomerCurrent);
