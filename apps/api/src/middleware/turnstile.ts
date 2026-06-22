import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { forbidden } from "../lib/app-error.js";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
// Cloudflare's standard field name; the web widget posts it as a header here.
const TOKEN_FIELD = "cf-turnstile-response";

let warnedBypass = false;

/**
 * Verify a Cloudflare Turnstile token before a protected action (Story 12.2).
 *
 * The token is read from the `cf-turnstile-response` header or a body field of
 * the same name and validated server-side via Cloudflare's siteverify endpoint
 * BEFORE the protected handler runs (so demo-mint never provisions on a failed
 * challenge). When `TURNSTILE_SECRET_KEY` is unset, the gate bypasses with a
 * one-time warning so local dev and CI are unaffected.
 *
 * Fails CLOSED: a missing/invalid token or an unreachable Cloudflare → 403. The
 * demo is non-critical; we prefer not to provision when we cannot verify.
 */
export async function verifyTurnstile(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    if (!config.TURNSTILE_SECRET_KEY) {
      if (!warnedBypass) {
        warnedBypass = true;
        // eslint-disable-next-line no-console
        console.warn("[turnstile] TURNSTILE_SECRET_KEY unset — bot-gate bypassed (dev/CI only)");
      }
      return next();
    }

    const token = readToken(req);
    if (!token) throw forbidden("TURNSTILE_REQUIRED", "Bot challenge required");

    const ok = await siteverify(token, req.ip);
    if (!ok) throw forbidden("TURNSTILE_FAILED", "Bot challenge failed; please try again");

    next();
  } catch (err) {
    next(err);
  }
}

function readToken(req: Request): string | undefined {
  const header = req.header(TOKEN_FIELD);
  if (header && header.length > 0) return header;
  const body = req.body as Record<string, unknown> | undefined;
  const fromBody = body?.[TOKEN_FIELD] ?? body?.turnstileToken;
  return typeof fromBody === "string" && fromBody.length > 0 ? fromBody : undefined;
}

async function siteverify(token: string, ip?: string): Promise<boolean> {
  const form = new URLSearchParams();
  form.set("secret", config.TURNSTILE_SECRET_KEY as string);
  form.set("response", token);
  if (ip) form.set("remoteip", ip);
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}
