import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { createLinkToken, exchangePublicToken } from "./accounts.controller.js";

export const accountsRouter: Router = Router();

accountsRouter.post("/plaid/link-token", requireAuth, createLinkToken);
accountsRouter.post("/plaid/exchange", requireAuth, exchangePublicToken);
