import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { config } from "../../config.js";

/**
 * Token helpers for Story 1.3.
 *
 * Access token = short-lived JWT (HS256, JWT_ACCESS_SECRET), claim sub=userId.
 * Refresh token = opaque high-entropy random string, stored ONLY as a SHA-256
 * hash (never plaintext). High entropy ⇒ a fast hash is sufficient; argon2's
 * slowness is for low-entropy passwords, not 256-bit random tokens.
 */

const accessSecret = new TextEncoder().encode(config.JWT_ACCESS_SECRET);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function issueAccessToken(userId: string): Promise<string> {
  // Derive the JWT exp from durationToSeconds so the token lifetime, the cookie
  // maxAge, and the DB expiry all come from ONE parser. jose's own duration
  // grammar differs from ours (it accepts "900", "1w", "15 minutes"); feeding it
  // the raw string would let the JWT exp silently diverge from the cookie/DB.
  const exp = Math.floor(Date.now() / 1000) + durationToSeconds(config.ACCESS_TOKEN_TTL);
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(accessSecret);
}

/** Verify an access JWT and return its subject (userId). Throws if invalid/expired. */
export async function verifyAccessToken(token: string): Promise<string> {
  const { payload } = await jwtVerify(token, accessSecret, { algorithms: ["HS256"] });
  if (typeof payload.sub !== "string" || !UUID_RE.test(payload.sub)) {
    throw new Error("access token missing subject");
  }
  return payload.sub;
}

/** A fresh opaque refresh token (the raw value handed to the client, once). */
export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hex of a refresh token — the only form persisted. */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Parse a duration ("15m", "7d", "30s", "2h") to seconds. The single source of
 * truth for every token lifetime (JWT exp, cookie maxAge, DB expiry). Requires a
 * positive integer + a unit — rejects "0s", leading zeros, bare numbers, words,
 * and "w"/"y" so a value that only one parser accepts can't slip through.
 */
export function durationToSeconds(ttl: string): number {
  const match = /^([1-9]\d*)([smhd])$/.exec(ttl.trim());
  if (!match) throw new Error(`invalid duration: ${ttl}`);
  const value = Number(match[1]);
  const unit = match[2];
  const per = unit === "s" ? 1 : unit === "m" ? 60 : unit === "h" ? 3600 : 86400;
  return value * per;
}
