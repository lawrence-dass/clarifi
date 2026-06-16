import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { prisma } from "@clarifi/shared";
import { AppError } from "../../lib/app-error.js";
import { registerUser } from "./auth.service.js";

// Integration test — needs a live DB. Skip when DATABASE_URL is unset or the
// placeholder so CI without a DB stays green (mirrors packages/shared/rls.test.ts).
const dbUrl = process.env.DATABASE_URL ?? "";
const hasDb = dbUrl.length > 0 && !dbUrl.includes("placeholder");

const emails: string[] = [];
function uniqueEmail(): string {
  const e = `reg-${randomUUID()}@example.test`;
  emails.push(e);
  return e;
}

describe.skipIf(!hasDb)("registerUser (integration)", () => {
  // Connect once, clean up + disconnect once (per-test disconnect forces a slow,
  // flaky reconnect through the Supabase pooler — see Story 1.1's rls.test.ts).
  afterAll(async () => {
    if (emails.length) {
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
    }
    await prisma.$disconnect();
  });

  it("creates a user with consentedAt set and only the argon2id hash stored (AC #2, #4)", async () => {
    const email = uniqueEmail();
    const before = Date.now();
    const user = await registerUser({ email, password: "correct-horse-battery", consent: true });

    expect(user.email).toBe(email);
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(user.consentedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    // The returned resource must not expose the hash.
    expect(user).not.toHaveProperty("passwordHash");

    // The stored value is a verifiable argon2id PHC string, not the plaintext.
    const row = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(row.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(row.passwordHash).not.toContain("correct-horse-battery");
    expect(await argon2.verify(row.passwordHash, "correct-horse-battery")).toBe(true);
  });

  it("rejects a duplicate email with a 409 EMAIL_TAKEN conflict (AC #3)", async () => {
    const email = uniqueEmail();
    await registerUser({ email, password: "correct-horse-battery", consent: true });

    // Single duplicate attempt; assert both the type and the contract fields.
    const err = await registerUser({ email, password: "another-valid-password", consent: true }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: "EMAIL_TAKEN", httpStatus: 409 });
  });
});
