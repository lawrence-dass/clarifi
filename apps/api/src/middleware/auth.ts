import type { Request, Response, NextFunction } from "express";
import { withUserContext } from "@clarifi/shared";
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
 * req.userId for downstream handlers. The subject must still exist in the DB:
 * after account deletion, old stateless access tokens must fail immediately
 * instead of remaining usable until expiry. Missing or invalid → 401 via the
 * error contract. Read the cookie via cookie-parser (mounted in createApp).
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = (req.cookies as Record<string, string> | undefined)?.[ACCESS_COOKIE];
    if (!token) throw unauthorized("UNAUTHENTICATED", "Authentication required");
    let userId: string;
    try {
      userId = await verifyAccessToken(token);
    } catch {
      throw unauthorized("UNAUTHENTICATED", "Authentication required");
    }
    const user = await withUserContext(userId, (tx) =>
      tx.user.findUnique({ where: { id: userId }, select: { id: true } }),
    );
    if (!user) throw unauthorized("UNAUTHENTICATED", "Authentication required");
    req.userId = userId;
    next();
  } catch (err) {
    next(err);
  }
}
