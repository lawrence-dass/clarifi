import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import {
  getFDXAccounts,
  getFDXAccountTransactions,
  getFDXCustomerCurrent,
} from "./fdx.controller.js";
import {
  getOAuthAuthorize,
  postOAuthToken,
  getConsents,
  postRevokeConsent,
} from "./oauth.controller.js";

export const fdxRouter: Router = Router();

// Resource endpoints (FDX canonical data in FDX format)
fdxRouter.get("/accounts", requireAuth, getFDXAccounts);
fdxRouter.get("/accounts/:accountId/transactions", requireAuth, getFDXAccountTransactions);
fdxRouter.get("/customers/current", requireAuth, getFDXCustomerCurrent);

// OAuth2 consent lifecycle
fdxRouter.get("/oauth/authorize", requireAuth, getOAuthAuthorize);
fdxRouter.post("/oauth/token", postOAuthToken); // no session auth — exchange code for token
fdxRouter.get("/oauth/consents", requireAuth, getConsents);
fdxRouter.post("/oauth/consents/:id/revoke", requireAuth, postRevokeConsent);
