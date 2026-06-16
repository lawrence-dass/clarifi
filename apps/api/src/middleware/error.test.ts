import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { z } from "zod";
import { errorMiddleware } from "./error.js";
import { AppError, conflict } from "../lib/app-error.js";

// Minimal Response double capturing status + json. No HTTP server needed.
function mockRes(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

const req = { log: { error: vi.fn() } } as unknown as Request;
const next = vi.fn();

describe("errorMiddleware", () => {
  it("renders an AppError with its code + httpStatus, omitting absent details", () => {
    const res = mockRes();
    errorMiddleware(conflict("EMAIL_TAKEN", "An account with this email already exists"), req, res, next);
    expect(res.statusCode).toBe(409);
    // No `details` key on the wire when it wasn't provided (matches the contract).
    expect(res.body).toEqual({
      error: { code: "EMAIL_TAKEN", message: "An account with this email already exists" },
    });
    expect((res.body as { error: object }).error).not.toHaveProperty("details");
  });

  it("includes details when the AppError carries them", () => {
    const res = mockRes();
    errorMiddleware(new AppError("X", 422, "bad", { field: "email" }), req, res, next);
    expect(res.statusCode).toBe(422);
    expect(res.body).toEqual({ error: { code: "X", message: "bad", details: { field: "email" } } });
  });

  it("maps a body-parser client error (numeric status) to that 4xx, not 500", () => {
    const res = mockRes();
    const parseErr = Object.assign(new SyntaxError("Unexpected token"), { status: 400 });
    errorMiddleware(parseErr, req, res, next);
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe("BAD_REQUEST");
  });

  it("maps a ZodError to 400 VALIDATION_ERROR", () => {
    const res = mockRes();
    const zerr = z.object({ email: z.string().email() }).safeParse({ email: "x" });
    errorMiddleware((zerr as { error: unknown }).error, req, res, next);
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
  });

  it("maps an unknown error to a generic 500 without leaking internals", () => {
    const res = mockRes();
    errorMiddleware(new Error("db password is hunter2"), req, res, next);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: { code: "INTERNAL", message: "Internal server error" } });
    expect(JSON.stringify(res.body)).not.toContain("hunter2");
  });

  it("AppError carries code, status, and optional details", () => {
    const e = new AppError("X", 418, "teapot", { hint: "short and stout" });
    expect([e.code, e.httpStatus]).toEqual(["X", 418]);
    expect(e.details).toEqual({ hint: "short and stout" });
  });
});
