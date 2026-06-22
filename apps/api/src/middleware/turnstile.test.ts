import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

const cfg = vi.hoisted(() => ({ config: { TURNSTILE_SECRET_KEY: undefined as string | undefined } }));
vi.mock("../config.js", () => cfg);

import { verifyTurnstile } from "./turnstile.js";

function makeReq(token?: string): Request {
  return {
    header: (name: string) => (name === "cf-turnstile-response" ? token : undefined),
    body: {},
    ip: "1.2.3.4",
  } as unknown as Request;
}

async function invoke(req: Request): Promise<unknown> {
  let captured: unknown = "NOT_CALLED";
  const next: NextFunction = (err?: unknown) => {
    captured = err ?? null;
  };
  await verifyTurnstile(req, {} as Response, next);
  return captured;
}

afterEach(() => {
  cfg.config.TURNSTILE_SECRET_KEY = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("verifyTurnstile", () => {
  it("bypasses (next with no error) when TURNSTILE_SECRET_KEY is unset", async () => {
    const result = await invoke(makeReq("anything"));
    expect(result).toBeNull();
  });

  it("403 TURNSTILE_REQUIRED when configured but no token is presented", async () => {
    cfg.config.TURNSTILE_SECRET_KEY = "secret";
    const result = await invoke(makeReq(undefined));
    expect(result).toMatchObject({ code: "TURNSTILE_REQUIRED", httpStatus: 403 });
  });

  it("passes when Cloudflare verifies the token as successful", async () => {
    cfg.config.TURNSTILE_SECRET_KEY = "secret";
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) })));
    const result = await invoke(makeReq("good-token"));
    expect(result).toBeNull();
  });

  it("403 TURNSTILE_FAILED when Cloudflare rejects the token", async () => {
    cfg.config.TURNSTILE_SECRET_KEY = "secret";
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ success: false }) })));
    const result = await invoke(makeReq("bad-token"));
    expect(result).toMatchObject({ code: "TURNSTILE_FAILED", httpStatus: 403 });
  });

  it("fails closed (403) when Cloudflare is unreachable", async () => {
    cfg.config.TURNSTILE_SECRET_KEY = "secret";
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));
    const result = await invoke(makeReq("some-token"));
    expect(result).toMatchObject({ code: "TURNSTILE_FAILED", httpStatus: 403 });
  });
});
