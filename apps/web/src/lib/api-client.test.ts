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
});
