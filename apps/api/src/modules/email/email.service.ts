/**
 * Email transport abstraction.
 *
 * In development / test: console-logs the email (no external dependency).
 * In production: configure SMTP_* env vars to send via nodemailer,
 *                or swap this module for a provider SDK (Resend, SendGrid, etc.).
 *
 * The interface is stable; swapping providers requires changing only this file.
 */

import { config } from "../../config.js";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export async function sendEmail(msg: EmailMessage): Promise<void> {
  if (config.NODE_ENV !== "production") {
    // Development: log email to console instead of sending
    // eslint-disable-next-line no-console
    console.log("[email:dev] Would send email", {
      to: msg.to,
      subject: msg.subject,
      textLength: msg.text.length,
    });
    return;
  }

  // Production: requires SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
  // to be set. Nodemailer is a peer dependency (not yet installed) — wire up
  // when a real email provider is configured.
  throw new Error(
    "Email sending in production requires SMTP configuration. " +
      "Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM environment variables " +
      "and wire up nodemailer in email.service.ts.",
  );
}
