import { Router } from "express";
import { handlePlaidWebhook } from "./webhooks.controller.js";

export const webhooksRouter: Router = Router();

webhooksRouter.post("/plaid", handlePlaidWebhook);
