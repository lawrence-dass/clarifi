import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { demoNLGuard } from "../../middleware/demo-nl-guard.js";
import { postNLQuery } from "./query.controller.js";

export const queryRouter: Router = Router();

// demoNLGuard runs after requireAuth (which sets req.isDemo) and before the
// controller reaches the LLM gateway — it caps demo-session LLM spend without
// touching real users (Story 12.2).
queryRouter.post("/nl", requireAuth, demoNLGuard, postNLQuery);
