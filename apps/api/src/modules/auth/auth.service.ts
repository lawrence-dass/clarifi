import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import {
  prisma,
  withUserContext,
  Prisma,
  type RegisterInput,
  type LoginInput,
  type DeleteAccountInput,
} from "@clarifi/shared";
import { conflict, unauthorized } from "../../lib/app-error.js";
import { config } from "../../config.js";
import { generateRefreshToken, hashToken, durationToSeconds, issueAccessToken } from "./tokens.js";

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
  // True for one-click public-demo users (Story 12.1); false for real accounts.
  isDemo: boolean;
}

export interface DeleteAccountResult {
  deleted: true;
  message: string;
  llmProviderLogHandling: string;
}

export const LLM_PROVIDER_LOG_HANDLING_NOTE =
  "Clarifi deletes its retained user data. This endpoint does not delete third-party LLM-provider logs; any provider-retained logs are expected to contain only anonymized transaction payloads and remain subject to the provider's retention controls.";

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
      select: { id: true, email: true, consentedAt: true, isDemo: true },
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

function isMissingUserDuringTokenIssue(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError
    && (err.code === "P2003" || err.code === "P2025")
  );
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

  let refreshToken: string;
  try {
    refreshToken = await issueRefreshRow(user.id, randomUUID());
  } catch (err) {
    if (isMissingUserDuringTokenIssue(err)) throw GENERIC_LOGIN_ERROR();
    throw err;
  }
  return {
    user: { id: user.id, email: user.email, consentedAt: user.consentedAt, isDemo: user.isDemo },
    refreshToken,
  };
}

/**
 * Mint a fresh authenticated session (access JWT + persisted refresh row in a new
 * family) for an already-resolved user id. Shared by flows that establish a
 * session without password verification — currently the one-click demo
 * (Story 12.1). The caller sets the cookies.
 */
export async function issueUserSession(
  userId: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = await issueAccessToken(userId);
  const refreshToken = await issueRefreshRow(userId, randomUUID());
  return { accessToken, refreshToken };
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
      // Lost a same-token concurrent rotation race. Do not revoke the family:
      // the winner may already have issued a fresh token in that family.
      throw new RotationRaceError();
      }
      const raw = generateRefreshToken();
      const expiresAt = new Date(Date.now() + durationToSeconds(config.REFRESH_TOKEN_TTL) * 1000);
      await tx.refreshToken.create({
        data: { userId: row.userId, tokenHash: hashToken(raw), familyId: row.familyId, expiresAt },
      });
      const user = await tx.user.findUniqueOrThrow({
        where: { id: row.userId },
        select: { id: true, email: true, consentedAt: true, isDemo: true },
      });
      return { user, refreshToken: raw };
    });
  } catch (err) {
    if (err instanceof RotationRaceError) {
      // Same-token concurrent loser. Reject this request, but keep the winner's
      // new token usable. True later replay still hits `row.revokedAt` above and
      // revokes the family as theft response.
      throw unauthorized("TOKEN_REUSE", "Refresh token reuse detected");
    }
    if (isMissingUserDuringTokenIssue(err)) {
      throw unauthorized("INVALID_REFRESH_TOKEN", "Refresh token is invalid or expired");
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
  return withUserContext(userId, (tx) =>
    tx.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, consentedAt: true, isDemo: true },
    }),
  );
}

/**
 * Delete the current user's account under RLS. The schema owns child-row
 * removal through ON DELETE CASCADE so this stays aligned with the data model:
 * accounts, transactions, budgets, anomalies, consents, and refresh tokens all
 * disappear with the user row.
 */
export async function deleteUserAccount(
  userId: string,
  input: DeleteAccountInput,
): Promise<DeleteAccountResult> {
  const user = await withUserContext(userId, (tx) =>
    tx.user.findUnique({ where: { id: userId }, select: { passwordHash: true } }),
  );
  if (!user) throw unauthorized("UNAUTHENTICATED", "Authentication required");

  const ok = await argon2.verify(user.passwordHash, input.currentPassword).catch(() => false);
  if (!ok) throw unauthorized("DELETE_REAUTH_FAILED", "Current password is required to delete this account");

  try {
    await withUserContext(userId, async (tx) => {
      await tx.user.delete({ where: { id: userId } });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      throw unauthorized("UNAUTHENTICATED", "Authentication required");
    }
    throw err;
  }

  return {
    deleted: true,
    message: "Your Clarifi account and user-owned Clarifi data have been deleted.",
    llmProviderLogHandling: LLM_PROVIDER_LOG_HANDLING_NOTE,
  };
}
