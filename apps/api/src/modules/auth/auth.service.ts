import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { prisma, Prisma, type RegisterInput, type LoginInput } from "@clarifi/shared";
import { conflict, unauthorized } from "../../lib/app-error.js";
import { config } from "../../config.js";
import { generateRefreshToken, hashToken, durationToSeconds } from "./tokens.js";

/**
 * argon2id parameters — architecture.md (OWASP 2026). memoryCost is in KiB,
 * so 65536 = 64 MiB. argon2 generates its own salt and encodes all params into
 * the returned PHC string, so verification (Story 1.3) needs only that string.
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
} as const;

export interface PublicUser {
  id: string;
  email: string;
  consentedAt: Date;
}

/**
 * Create a PIPEDA-consented user. Uses the base `prisma` client directly — NOT
 * withUserContext — because signup runs before any auth context exists (there
 * is no userId yet, and the RLS users_insert policy permits inserts when no
 * `app.current_user_id` is set; see migration 0004). This is the one sanctioned
 * exception to "all user-data access goes through withUserContext".
 *
 * Only the argon2 hash is persisted; the plaintext password is never stored or
 * logged. `consent` is already validated to be exactly `true` by RegisterInput.
 */
export async function registerUser(input: RegisterInput): Promise<PublicUser> {
  const passwordHash = await argon2.hash(input.password, ARGON2_OPTIONS);

  try {
    return await prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        consentedAt: new Date(),
      },
      select: { id: true, email: true, consentedAt: true },
    });
  } catch (err) {
    // P2002 = unique constraint violation (users.email already registered).
    // Note: returning a distinct 409 reveals the email exists — an accepted
    // UX-over-enumeration tradeoff for v1 (see story Dev Notes).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw conflict("EMAIL_TAKEN", "An account with this email already exists");
    }
    throw err;
  }
}

// ── Login + refresh-token rotation (Story 1.3) ─────────────────────────────
//
// All flows below run PRE-AUTH (no user context yet), so they use the base
// `prisma` client, not withUserContext — the same sanctioned exception as
// registration. Refresh-token rows are looked up by their unique token_hash.

// A real argon2id hash computed once, used to equalize timing when the email is
// unknown so an attacker can't enumerate accounts by response latency. It must
// be a genuine hash (not a fabricated string) — otherwise argon2.verify would
// fail to parse and return fast, leaking the "no such user" path via timing.
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  return (dummyHashPromise ??= argon2.hash("clarifi-timing-equalizer", ARGON2_OPTIONS));
}

const GENERIC_LOGIN_ERROR = () =>
  unauthorized("INVALID_CREDENTIALS", "Invalid email or password");

export interface IssuedTokens {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
}

async function issueRefreshRow(userId: string, familyId: string): Promise<string> {
  const raw = generateRefreshToken();
  const expiresAt = new Date(Date.now() + durationToSeconds(config.REFRESH_TOKEN_TTL) * 1000);
  await prisma.refreshToken.create({
    data: { userId, tokenHash: hashToken(raw), familyId, expiresAt },
  });
  return raw;
}

/**
 * Verify credentials and start a session. Returns the user + a new refresh
 * token (caller mints the access token and sets cookies). Wrong email and
 * wrong password yield the SAME generic 401; a missing user still runs an
 * argon2 verify against a dummy hash (timing-safe, no enumeration).
 */
export async function loginUser(input: LoginInput): Promise<Omit<IssuedTokens, "accessToken">> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) {
    await argon2.verify(await getDummyHash(), input.password).catch(() => false);
    throw GENERIC_LOGIN_ERROR();
  }
  const ok = await argon2.verify(user.passwordHash, input.password).catch(() => false);
  if (!ok) throw GENERIC_LOGIN_ERROR();

  const refreshToken = await issueRefreshRow(user.id, randomUUID());
  return {
    user: { id: user.id, email: user.email, consentedAt: user.consentedAt },
    refreshToken,
  };
}

/**
 * Rotate a refresh token: revoke the presented one and issue a fresh one in the
 * same family. Reuse of an already-revoked token revokes the whole family
 * (theft response). Expired/unknown tokens are rejected.
 */
export async function rotateRefreshToken(
  rawToken: string,
): Promise<Omit<IssuedTokens, "accessToken">> {
  const tokenHash = hashToken(rawToken);
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash } });

  if (!row || row.expiresAt.getTime() <= Date.now()) {
    throw unauthorized("INVALID_REFRESH_TOKEN", "Refresh token is invalid or expired");
  }
  if (row.revokedAt) {
    // Reuse of an already-rotated token: assume theft, revoke the whole family.
    await revokeFamily(row.familyId);
    throw unauthorized("TOKEN_REUSE", "Refresh token reuse detected");
  }

  // Atomic rotation. The CONDITIONAL revoke (`where: { revokedAt: null }`) is the
  // race guard: two concurrent rotations of the same token both pass the read
  // above, but only one's updateMany matches `revokedAt: null` (the row lock
  // serializes them) → count === 1. The loser sees count === 0 and is treated as
  // reuse. Wrapping the revoke + issue in one transaction keeps them atomic so we
  // never revoke without issuing (or vice versa).
  try {
    return await prisma.$transaction(async (tx) => {
      const revoked = await tx.refreshToken.updateMany({
        where: { id: row.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (revoked.count !== 1) {
        // Lost the race — the token was revoked between our read and write.
        throw new RotationRaceError();
      }
      const raw = generateRefreshToken();
      const expiresAt = new Date(Date.now() + durationToSeconds(config.REFRESH_TOKEN_TTL) * 1000);
      await tx.refreshToken.create({
        data: { userId: row.userId, tokenHash: hashToken(raw), familyId: row.familyId, expiresAt },
      });
      const user = await tx.user.findUniqueOrThrow({
        where: { id: row.userId },
        select: { id: true, email: true, consentedAt: true },
      });
      return { user, refreshToken: raw };
    });
  } catch (err) {
    if (err instanceof RotationRaceError) {
      // A concurrent rotation already consumed this token → treat as reuse.
      await revokeFamily(row.familyId);
      throw unauthorized("TOKEN_REUSE", "Refresh token reuse detected");
    }
    throw err;
  }
}

/** Revoke every still-active token in a family (theft / reuse response). */
async function revokeFamily(familyId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Internal sentinel: the conditional revoke lost a concurrent rotation race. */
class RotationRaceError extends Error {}

/** Revoke a refresh token (logout). Idempotent — unknown/already-revoked is a no-op. */
export async function revokeRefreshToken(rawToken: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Fetch the public user resource by id (for GET /auth/me). */
export async function getPublicUser(userId: string): Promise<PublicUser | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, consentedAt: true },
  });
}
