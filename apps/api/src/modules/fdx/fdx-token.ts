import { SignJWT, jwtVerify } from "jose";
import { config } from "../../config.js";

const FDX_TOKEN_TTL_S = 3600; // 1 hour

// Use same secret as access tokens — in production these would be separate keys.
const secret = new TextEncoder().encode(config.JWT_ACCESS_SECRET);

export interface FDXTokenClaims {
  userId: string;
  scopes: string[];
}

export async function issueFDXAccessToken(claims: FDXTokenClaims): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + FDX_TOKEN_TTL_S;
  return new SignJWT({ scopes: claims.scopes, fdx: true })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(secret);
}

export async function verifyFDXAccessToken(token: string): Promise<FDXTokenClaims> {
  const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
  if (typeof payload.sub !== "string" || payload.fdx !== true) {
    throw new Error("invalid FDX token");
  }
  const scopes = Array.isArray(payload.scopes) ? (payload.scopes as string[]) : [];
  return { userId: payload.sub, scopes };
}

export const FDX_TOKEN_TTL_SECONDS = FDX_TOKEN_TTL_S;
