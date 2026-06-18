import { Buffer } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";

const KEY_A = Buffer.alloc(32, 1).toString("base64");
const KEY_B = Buffer.alloc(32, 2).toString("base64");

describe("secret crypto", () => {
  afterEach(() => {
    vi.resetModules();
    process.env.ENCRYPTION_KEY = KEY_A;
  });

  it("round-trips a secret and does not include plaintext in the envelope", async () => {
    process.env.ENCRYPTION_KEY = KEY_A;
    vi.resetModules();
    const { encryptSecret, decryptSecret } = await import("./crypto.js");

    const plaintext = "access-sandbox-plain-token";
    const encrypted = encryptSecret(plaintext);

    expect(encrypted).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/);
    expect(encrypted).not.toContain(plaintext);
    expect(decryptSecret(encrypted)).toBe(plaintext);
  });

  it("uses a random IV for each encryption", async () => {
    process.env.ENCRYPTION_KEY = KEY_A;
    vi.resetModules();
    const { encryptSecret, decryptSecret } = await import("./crypto.js");

    const first = encryptSecret("same-token");
    const second = encryptSecret("same-token");

    expect(first).not.toBe(second);
    expect(decryptSecret(first)).toBe("same-token");
    expect(decryptSecret(second)).toBe("same-token");
  });

  it("rejects tampered ciphertext or auth tags", async () => {
    process.env.ENCRYPTION_KEY = KEY_A;
    vi.resetModules();
    const { encryptSecret, decryptSecret } = await import("./crypto.js");

    const encrypted = encryptSecret("sensitive-token");
    const parts = encrypted.split(":");
    parts[3] = `${parts[3]}AA`;

    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });

  it("rejects decryption under the wrong key", async () => {
    process.env.ENCRYPTION_KEY = KEY_A;
    vi.resetModules();
    const firstModule = await import("./crypto.js");
    const encrypted = firstModule.encryptSecret("sensitive-token");

    process.env.ENCRYPTION_KEY = KEY_B;
    vi.resetModules();
    const secondModule = await import("./crypto.js");

    expect(() => secondModule.decryptSecret(encrypted)).toThrow();
  });

  it("fails fast when ENCRYPTION_KEY is not exactly 32 bytes", async () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(31, 1).toString("base64");
    vi.resetModules();

    await expect(import("./crypto.js")).rejects.toThrow("ENCRYPTION_KEY must decode to exactly 32 bytes");
  });
});
