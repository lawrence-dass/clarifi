import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { postNLQuery } from "./query.controller.js";

export const queryRouter: Router = Router();

queryRouter.post("/nl", requireAuth, postNLQuery);
