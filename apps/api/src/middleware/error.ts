import type { ErrorRequestHandler, Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { AppError } from "../lib/app-error.js";

/**
 * Central error middleware. Renders the project error contract
 * `{ error: { code, message, details? } }` and never leaks internals:
 *   - AppError  → its own httpStatus + code
 *   - ZodError  → 400 VALIDATION_ERROR with flattened field issues
 *   - anything else → 500 INTERNAL with a generic message
 *
 * Register LAST in createApp(), after all routes. The unused `_next` param is
 * required so Express recognizes this as an error handler (arity 4).
 */
export const errorMiddleware: ErrorRequestHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) => {
  if (err instanceof AppError) {
    const body: { code: string; message: string; details?: unknown } = {
      code: err.code,
      message: err.message,
    };
    if (err.details !== undefined) body.details = err.details;
    res.status(err.httpStatus).json({ error: body });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: err.flatten(),
      },
    });
    return;
  }

  // Client-fault errors thrown by middleware (body-parser) carry a numeric
  // status: malformed JSON → 400, payload over the 1mb limit → 413. Honor it
  // rather than masking a client mistake as a 500.
  const status = (err as { status?: number; statusCode?: number })?.status
    ?? (err as { statusCode?: number })?.statusCode;
  if (typeof status === "number" && status >= 400 && status < 500) {
    res.status(status).json({
      error: { code: status === 413 ? "PAYLOAD_TOO_LARGE" : "BAD_REQUEST", message: "Invalid request" },
    });
    return;
  }

  // Unknown error: log server-side (pino, attached by pino-http), return generic.
  req.log?.error({ err }, "unhandled error");
  res.status(500).json({
    error: { code: "INTERNAL", message: "Internal server error" },
  });
};
