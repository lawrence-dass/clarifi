import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiClient } from "./api-client";

describe("apiClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends credentials and JSON bodies through the configured base URL", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      capturedInit = init;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      apiClient<{ ok: boolean }>("/auth/login", {
        method: "POST",
        body: { email: "user@example.test", password: "correct-horse-battery" },
      }),
    ).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/login",
      expect.objectContaining({
        credentials: "include",
        method: "POST",
        body: JSON.stringify({
          email: "user@example.test",
          password: "correct-horse-battery",
        }),
      }),
    );
    expect(capturedInit).toBeDefined();
    const headers = capturedInit!.headers as Headers;
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("maps the central error envelope to ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "INVALID_CREDENTIALS",
              message: "Invalid email or password",
              details: { fieldErrors: {} },
            },
          }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const error = await apiClient("/auth/login", { method: "POST", body: {} }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 401,
      code: "INVALID_CREDENTIALS",
      message: "Invalid email or password",
      details: { fieldErrors: {} },
    });
  });

  it("refreshes once on a 401 and retries the original request", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/auth/refresh")) {
        return new Response(null, { status: 200 });
      }
      // First protected call 401s; after refresh, the retry succeeds.
      const priorRefresh = calls.some((c) => c.includes("/auth/refresh"));
      return new Response(JSON.stringify({ ok: priorRefresh }), {
        status: priorRefresh ? 200 : 401,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiClient<{ ok: boolean }>("/anomalies")).resolves.toEqual({ ok: true });

    expect(calls).toEqual([
      "GET /api/anomalies",
      "POST /api/auth/refresh",
      "GET /api/anomalies",
    ]);
  });

  it("shares a single refresh across a burst of simultaneous 401s", async () => {
    let refreshCount = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/auth/refresh")) {
        refreshCount += 1;
        return new Response(null, { status: 200 });
      }
      // 401 until at least one refresh has completed.
      return new Response(JSON.stringify({ ok: refreshCount > 0 }), {
        status: refreshCount > 0 ? 200 : 401,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([
      apiClient("/anomalies"),
      apiClient("/budgets"),
      apiClient("/summary"),
    ]);

    expect(refreshCount).toBe(1);
  });

  it("does not refresh-retry a 401 from the login endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: { code: "INVALID_CREDENTIALS", message: "nope" } }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await apiClient("/auth/login", { method: "POST", body: {} }).catch(() => undefined);

    expect(fetchMock).toHaveBeenCalledTimes(1); // no /auth/refresh attempt
  });
});
