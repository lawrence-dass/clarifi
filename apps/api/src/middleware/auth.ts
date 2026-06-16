import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../modules/auth/tokens.js";
import { ACCESS_COOKIE } from "../modules/auth/cookies.js";
import { unauthorized } from "../lib/app-error.js";

// Augment Express's Request with the authenticated user id set by requireAuth.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

/**
 * Gate a route on a valid access-token cookie. Verifies the JWT and sets
 * req.userId for downstream handlers. Missing or invalid → 401 via the error
 * contract. Read the cookie via cookie-parser (mounted in createApp).
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = (req.cookies as Record<string, string> | undefined)?.[ACCESS_COOKIE];
    if (!token) throw unauthorized("UNAUTHENTICATED", "Authentication required");
    req.userId = await verifyAccessToken(token);
    next();
  } catch (err) {
    // Any verify failure (expired, tampered, malformed) is a 401, not a 500.
    if (err && typeof err === "object" && "httpStatus" in err) return next(err);
    next(unauthorized("UNAUTHENTICATED", "Authentication required"));
  }
}
