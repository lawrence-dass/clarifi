import { randomBytes } from "node:crypto";
import { withUserContext } from "@clarifi/shared";

// In-memory auth code store: code → { userId, scopes, redirectUri, expiresAt }
// Codes are single-use and expire in 60 seconds (standard OAuth2 code TTL).
const AUTH_CODES = new Map<
  string,
  { userId: string; scopes: string[]; redirectUri: string; expiresAt: number }
>();

const CODE_TTL_MS = 60_000;
const SUPPORTED_SCOPES = new Set([
  "accounts:read",
  "transactions:read",
  "customers:read",
]);

export function parseScopeString(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function validateScopes(scopes: string[]): string[] {
  const granted = scopes.filter((s) => SUPPORTED_SCOPES.has(s));
  if (granted.length === 0) throw new Error("No supported scopes requested");
  return granted;
}

export async function createAuthorizationCode(params: {
  userId: string;
  scopes: string[];
  redirectUri: string;
}): Promise<{ code: string; consentId: string }> {
  const granted = validateScopes(params.scopes);

  const consent = await withUserContext(params.userId, (tx) =>
    tx.consent.create({
      data: {
        userId: params.userId,
        provider: "fdx",
        scopes: granted,
        status: "granted",
        grantedAt: new Date(),
      },
      select: { id: true },
    }),
  );

  const code = randomBytes(24).toString("base64url");
  AUTH_CODES.set(code, {
    userId: params.userId,
    scopes: granted,
    redirectUri: params.redirectUri,
    expiresAt: Date.now() + CODE_TTL_MS,
  });

  return { code, consentId: consent.id };
}

export function redeemAuthorizationCode(
  code: string,
  redirectUri: string,
): { userId: string; scopes: string[] } {
  const entry = AUTH_CODES.get(code);
  if (!entry) throw new Error("invalid_grant");
  if (Date.now() > entry.expiresAt) {
    AUTH_CODES.delete(code);
    throw new Error("invalid_grant");
  }
  if (entry.redirectUri !== redirectUri) throw new Error("invalid_grant");

  AUTH_CODES.delete(code); // single-use
  return { userId: entry.userId, scopes: entry.scopes };
}

export async function listConsents(userId: string) {
  return withUserContext(userId, (tx) =>
    tx.consent.findMany({
      where: { userId, provider: "fdx" },
      orderBy: { grantedAt: "desc" },
      select: {
        id: true,
        scopes: true,
        status: true,
        grantedAt: true,
        revokedAt: true,
      },
    }),
  );
}

export async function revokeConsent(params: {
  userId: string;
  consentId: string;
}): Promise<void> {
  await withUserContext(params.userId, (tx) =>
    tx.consent.updateMany({
      where: { id: params.consentId, userId: params.userId, status: "granted" },
      data: { status: "revoked", revokedAt: new Date() },
    }),
  );
}
