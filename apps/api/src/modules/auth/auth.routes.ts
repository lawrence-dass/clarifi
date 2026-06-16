import { Router } from "express";
import { register } from "./auth.controller.js";

/**
 * Auth routes. Mounted at /auth in createApp(). Login + token rotation
 * (POST /auth/login, /auth/refresh) land in Story 1.3.
 */
export const authRouter: Router = Router();

authRouter.post("/register", register);
