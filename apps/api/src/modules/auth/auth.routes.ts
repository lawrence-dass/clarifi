import { Router } from "express";
import { register, login, refresh, logout, me, deleteMe } from "./auth.controller.js";
import { requireAuth } from "../../middleware/auth.js";

/**
 * Auth routes, mounted at /auth in createApp(). The refresh cookie is
 * path-scoped to /auth, so /refresh and /logout receive it.
 */
export const authRouter: Router = Router();

authRouter.post("/register", register);
authRouter.post("/login", login);
authRouter.post("/refresh", refresh);
authRouter.post("/logout", logout);
authRouter.get("/me", requireAuth, me);
authRouter.delete("/me", requireAuth, deleteMe);
