import { Router } from "express";
import { createDemoSession } from "./demo.controller.js";

export const demoRouter: Router = Router();

// Public entry — no requireAuth. Story 12.2 adds Turnstile + rate-limit middleware here.
demoRouter.post("/session", createDemoSession);
