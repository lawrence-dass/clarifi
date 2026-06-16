import type { Request, Response, NextFunction } from "express";
import { RegisterInput } from "@clarifi/shared";
import { registerUser } from "./auth.service.js";

/**
 * POST /auth/register — parse the body with the shared Zod schema (a ZodError
 * is caught by the central error middleware → 400), create the account, and
 * return the bare resource (201). The password hash is never returned.
 */
export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = RegisterInput.parse(req.body);
    const user = await registerUser(input);
    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
}
