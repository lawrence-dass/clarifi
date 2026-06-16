import { z } from "zod";

/**
 * Shared auth schemas. Guardrail (CLAUDE.md): validate all external input with
 * Zod at the boundary. This schema is the single source of truth for the
 * registration contract — imported by the API controller and (later) the web
 * sign-up form so the client and server never drift.
 */

/**
 * Registration request body.
 * - `email`: trimmed + lowercased so `A@x.com` and `a@x.com` collide on the
 *   `users.email` unique constraint instead of creating duplicate accounts.
 *   Capped at 254 chars (RFC 5321) so an unbounded value can't bypass the
 *   bound-input rule. `.email()` is ASCII-only, so accepted addresses are
 *   already Unicode-normalized — no NFC step needed to prevent form-collision
 *   duplicates (a non-ASCII / decomposed local part is rejected outright).
 * - `password`: 12–128 chars. Min 12 is the policy floor; max 128 caps argon2
 *   input (hashing is intentionally expensive, so unbounded input is a DoS vector).
 * - `consent`: must be exactly `true` (PIPEDA explicit consent at signup).
 */
export const RegisterInput = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(12).max(128),
  consent: z.literal(true),
});

export type RegisterInput = z.infer<typeof RegisterInput>;
