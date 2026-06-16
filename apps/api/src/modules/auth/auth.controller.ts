import type { Request, Response, NextFunction } from "express";
import { RegisterInput, LoginInput, DeleteAccountInput } from "@clarifi/shared";
import {
  registerUser,
  loginUser,
  rotateRefreshToken,
  revokeRefreshToken,
  getPublicUser,
  deleteUserAccount,
} from "./auth.service.js";
import { issueAccessToken } from "./tokens.js";
import { setAuthCookies, clearAuthCookies, REFRESH_COOKIE } from "./cookies.js";
import { unauthorized } from "../../lib/app-error.js";

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

function readRefreshCookie(req: Request): string | undefined {
  return (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
}

/**
 * POST /auth/login — verify credentials, set access+refresh cookies, return the
 * bare user resource (200). No token in the body, no passwordHash.
 */
export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = LoginInput.parse(req.body);
    const { user, refreshToken } = await loginUser(input);
    const accessToken = await issueAccessToken(user.id);
    setAuthCookies(res, { accessToken, refreshToken });
    res.status(200).json(user);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /auth/refresh — rotate the refresh token (issue a new pair, invalidate
 * the old), set fresh cookies, return the user (200).
 */
export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const raw = readRefreshCookie(req);
    if (!raw) throw unauthorized("NO_REFRESH_TOKEN", "No refresh token provided");
    const { user, refreshToken } = await rotateRefreshToken(raw);
    const accessToken = await issueAccessToken(user.id);
    setAuthCookies(res, { accessToken, refreshToken });
    res.status(200).json(user);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /auth/logout — revoke the current refresh token and clear both cookies
 * (204). Idempotent: always clears cookies, even without a valid token.
 */
export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const raw = readRefreshCookie(req);
    if (raw) await revokeRefreshToken(raw);
    clearAuthCookies(res);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

/**
 * GET /auth/me — return the authenticated user (requireAuth sets req.userId).
 */
export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.userId ? await getPublicUser(req.userId) : null;
    if (!user) throw unauthorized("UNAUTHENTICATED", "Authentication required");
    res.status(200).json(user);
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /auth/me — delete the authenticated account and all user-owned data
 * through DB cascades. Returns an explicit PIPEDA confirmation payload and
 * clears auth cookies in the same response.
 */
export async function deleteMe(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.userId) throw unauthorized("UNAUTHENTICATED", "Authentication required");
    const input = DeleteAccountInput.parse(req.body);
    const result = await deleteUserAccount(req.userId, input);
    clearAuthCookies(res);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
