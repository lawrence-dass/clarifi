import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { badRequest, unauthorized } from "../../lib/app-error.js";
import {
  createAuthorizationCode,
  parseScopeString,
  redeemAuthorizationCode,
  listConsents,
  revokeConsent,
} from "./consent.service.js";
import { issueFDXAccessToken, FDX_TOKEN_TTL_SECONDS } from "./fdx-token.js";

const AuthorizeQuery = z.object({
  client_id: z.string().min(1),
  response_type: z.literal("code"),
  scope: z.string().min(1),
  redirect_uri: z.string().url(),
  state: z.string().optional(),
});

const TokenBody = z.object({
  grant_type: z.literal("authorization_code"),
  code: z.string().min(1),
  redirect_uri: z.string().url(),
  client_id: z.string().min(1),
});

const RevokeBody = z.object({
  consent_id: z.string().uuid(),
});

/**
 * GET /fdx/oauth/authorize
 *
 * Mock authorization endpoint. In a real FDX flow the bank would show a consent
 * UI; here, since the Clarifi user is already authenticated via session cookie,
 * we auto-grant and return the auth code directly (JSON, for the mock API).
 */
export async function getOAuthAuthorize(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.userId) throw unauthorized("UNAUTHENTICATED", "Authentication required");

    const parsed = AuthorizeQuery.safeParse(req.query);
    if (!parsed.success) {
      throw badRequest("INVALID_PARAMS", "Invalid authorization request", parsed.error.flatten());
    }

    const scopes = parseScopeString(parsed.data.scope);
    const { code, consentId } = await createAuthorizationCode({
      userId: req.userId,
      scopes,
      redirectUri: parsed.data.redirect_uri,
    });

    // Mock: return JSON instead of redirect (browser flow not needed for API mock)
    res.status(200).json({
      code,
      state: parsed.data.state,
      consentId,
      redirectUri: parsed.data.redirect_uri,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /fdx/oauth/token
 * Exchanges an authorization code for an FDX access token.
 */
export async function postOAuthToken(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = TokenBody.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest("INVALID_REQUEST", "Invalid token request", parsed.error.flatten());
    }

    let redemption: { userId: string; scopes: string[] };
    try {
      redemption = redeemAuthorizationCode(parsed.data.code, parsed.data.redirect_uri);
    } catch {
      res.status(400).json({ error: "invalid_grant", error_description: "Code invalid or expired" });
      return;
    }

    const accessToken = await issueFDXAccessToken(redemption);
    res.status(200).json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: FDX_TOKEN_TTL_SECONDS,
      scope: redemption.scopes.join(" "),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /fdx/oauth/consents
 * Lists all FDX consents for the authenticated user (for the consent dashboard).
 */
export async function getConsents(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.userId) throw unauthorized("UNAUTHENTICATED", "Authentication required");
    const consents = await listConsents(req.userId);
    res.status(200).json({ consents });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /fdx/oauth/consents/:id/revoke
 * Revokes a specific consent, marking it and any associated access as revoked.
 */
export async function postRevokeConsent(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.userId) throw unauthorized("UNAUTHENTICATED", "Authentication required");

    const consentId = req.params["id"];
    if (!consentId) throw badRequest("MISSING_ID", "Consent ID is required");

    await revokeConsent({ userId: req.userId, consentId });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
