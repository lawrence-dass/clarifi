import { describe, expect, it } from "vitest";
import { RegisterInput } from "./auth.js";

// Pure schema unit tests — no DB, always run in CI.
describe("RegisterInput", () => {
  const valid = {
    email: "User@Example.com",
    password: "correct-horse-battery",
    consent: true,
  };

  it("accepts a valid registration body", () => {
    const parsed = RegisterInput.parse(valid);
    expect(parsed.consent).toBe(true);
    expect(parsed.password).toBe("correct-horse-battery");
  });

  it("lowercases and trims the email so duplicates collide on the unique constraint", () => {
    const parsed = RegisterInput.parse({ ...valid, email: "  User@Example.com  " });
    expect(parsed.email).toBe("user@example.com");
  });

  it("rejects consent that is not exactly true", () => {
    expect(RegisterInput.safeParse({ ...valid, consent: false }).success).toBe(false);
    expect(RegisterInput.safeParse({ ...valid, consent: "true" }).success).toBe(false);
    expect(RegisterInput.safeParse({ ...valid, consent: undefined }).success).toBe(false);
  });

  it("rejects a malformed email", () => {
    expect(RegisterInput.safeParse({ ...valid, email: "not-an-email" }).success).toBe(false);
  });

  it("rejects non-ASCII email local parts (so Unicode-form duplicates can't occur)", () => {
    // A decomposed/accented local part is rejected outright by .email(), which
    // is ASCII-only — this is what makes a separate NFC step unnecessary.
    const accented = "jos" + String.fromCodePoint(0x00e9) + "@example.com";
    expect(RegisterInput.safeParse({ ...valid, email: accented }).success).toBe(false);
  });

  it("rejects an email longer than 254 characters (RFC 5321)", () => {
    const longLocal = "a".repeat(250);
    expect(RegisterInput.safeParse({ ...valid, email: `${longLocal}@x.com` }).success).toBe(false);
  });

  it("rejects a password shorter than 12 characters", () => {
    expect(RegisterInput.safeParse({ ...valid, password: "short" }).success).toBe(false);
    expect(RegisterInput.safeParse({ ...valid, password: "01234567890" }).success).toBe(false); // 11
    expect(RegisterInput.safeParse({ ...valid, password: "012345678901" }).success).toBe(true); // 12
  });

  it("rejects a password longer than 128 characters (argon2 DoS guard)", () => {
    expect(RegisterInput.safeParse({ ...valid, password: "a".repeat(129) }).success).toBe(false);
    expect(RegisterInput.safeParse({ ...valid, password: "a".repeat(128) }).success).toBe(true);
  });
});
