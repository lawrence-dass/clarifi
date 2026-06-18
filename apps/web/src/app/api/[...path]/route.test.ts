import { describe, expect, it } from "vitest";
import { rewriteSetCookieForBff } from "./route";

describe("BFF cookie rewriting", () => {
  it("maps API refresh-cookie path to the same-origin BFF auth path", () => {
    expect(
      rewriteSetCookieForBff("refresh_token=abc; Max-Age=604800; Path=/auth; HttpOnly; SameSite=Strict"),
    ).toBe("refresh_token=abc; Max-Age=604800; Path=/api/auth; HttpOnly; SameSite=Strict");
  });

  it("leaves site-wide cookies unchanged", () => {
    expect(rewriteSetCookieForBff("access_token=abc; Max-Age=900; Path=/; HttpOnly; SameSite=Strict")).toBe(
      "access_token=abc; Max-Age=900; Path=/; HttpOnly; SameSite=Strict",
    );
  });
});
