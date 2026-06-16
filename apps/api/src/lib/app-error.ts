/**
 * Typed application error. Guardrail (architecture.md): handlers throw a typed
 * AppError (code + httpStatus); the central error middleware renders it as
 * `{ error: { code, message, details? } }`. Never leak internals to clients.
 */
export class AppError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly details?: unknown;

  constructor(code: string, httpStatus: number, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export function badRequest(code: string, message: string, details?: unknown): AppError {
  return new AppError(code, 400, message, details);
}

export function conflict(code: string, message: string, details?: unknown): AppError {
  return new AppError(code, 409, message, details);
}

export function notFound(code: string, message: string, details?: unknown): AppError {
  return new AppError(code, 404, message, details);
}

export function unauthorized(code: string, message: string, details?: unknown): AppError {
  return new AppError(code, 401, message, details);
}
