import argon2 from "argon2";
import { prisma, Prisma, type RegisterInput } from "@clarifi/shared";
import { conflict } from "../../lib/app-error.js";

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
