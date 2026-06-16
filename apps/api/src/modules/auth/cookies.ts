import type { Response } from "express";
import { config } from "../../config.js";
import { durationToSeconds } from "./tokens.js";

/**
 * Auth cookie names and set/clear helpers.
 *
 * Both cookies are httpOnly (JS can't read them), Secure in production, and
 * SameSite=strict. The refresh cookie is path-scoped to /auth so it's only
 * sent to the auth endpoints that need it. clearCookie MUST use the same
 * path/sameSite/secure options or the browser won't clear it.
 */
export const ACCESS_COOKIE = "access_token";
export const REFRESH_COOKIE = "refresh_token";
const REFRESH_PATH = "/auth";

const baseOpts = {
  httpOnly: true,
  secure: config.NODE_ENV === "production",
  sameSite: "strict" as const,
};

export function setAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string },
): void {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...baseOpts,
    path: "/",
    maxAge: durationToSeconds(config.ACCESS_TOKEN_TTL) * 1000,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...baseOpts,
    path: REFRESH_PATH,
    maxAge: durationToSeconds(config.REFRESH_TOKEN_TTL) * 1000,
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { ...baseOpts, path: "/" });
  res.clearCookie(REFRESH_COOKIE, { ...baseOpts, path: REFRESH_PATH });
}
