import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  issueAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashToken,
  durationToSeconds,
} from "./tokens.js";

// Pure-unit (no DB). Relies on JWT_ACCESS_SECRET from the root .env (loaded by
// vitest.config.ts).
describe("access token", () => {
  it("issues a JWT that verifies and round-trips the userId", async () => {
    const userId = randomUUID();
    const token = await issueAccessToken(userId);
    expect(token.split(".")).toHaveLength(3); // header.payload.signature
    expect(await verifyAccessToken(token)).toBe(userId);
  });

  it("rejects a tampered token", async () => {
    const token = await issueAccessToken(randomUUID());
    await expect(verifyAccessToken(token + "x")).rejects.toBeTruthy();
  });

  it("rejects a garbage token", async () => {
    await expect(verifyAccessToken("not-a-jwt")).rejects.toBeTruthy();
  });

  it("rejects a signed token whose subject is not a UUID", async () => {
    const token = await issueAccessToken("not-a-uuid");
    await expect(verifyAccessToken(token)).rejects.toBeTruthy();
  });
});

describe("refresh token", () => {
  it("generates distinct, high-entropy opaque tokens", () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43); // 32 bytes base64url
  });

  it("hashes deterministically and never echoes the input", () => {
    const raw = generateRefreshToken();
    expect(hashToken(raw)).toBe(hashToken(raw));
    expect(hashToken(raw)).not.toContain(raw);
    expect(hashToken(raw)).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });
});

describe("durationToSeconds", () => {
  it("parses s/m/h/d units", () => {
    expect(durationToSeconds("30s")).toBe(30);
    expect(durationToSeconds("15m")).toBe(900);
    expect(durationToSeconds("2h")).toBe(7200);
    expect(durationToSeconds("7d")).toBe(604800);
  });

  it("throws on a malformed duration", () => {
    expect(() => durationToSeconds("nope")).toThrow();
  });
});
