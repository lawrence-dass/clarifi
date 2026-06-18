import { createHash, timingSafeEqual } from "node:crypto";
import { decodeProtectedHeader, importJWK, jwtVerify } from "jose";
import { plaidAdapter, type PlaidAdapter } from "../../lib/plaid-adapter.js";

export interface PlaidWebhookVerificationInput {
  verificationHeader: string | undefined;
  rawBody: Buffer | undefined;
}

export interface PlaidWebhookVerifier {
  verify(input: PlaidWebhookVerificationInput): Promise<boolean>;
}

export class PlaidJwtWebhookVerifier implements PlaidWebhookVerifier {
  constructor(private readonly adapter: PlaidAdapter = plaidAdapter) {}

  async verify(input: PlaidWebhookVerificationInput): Promise<boolean> {
    if (!input.verificationHeader || !input.rawBody) return false;

    try {
      const header = decodeProtectedHeader(input.verificationHeader);
      if (!header.kid) return false;
      const key = await this.adapter.getWebhookVerificationKey(header.kid);
      const importedKey = await importJWK(key, "ES256");
      const { payload } = await jwtVerify(input.verificationHeader, importedKey, {
        algorithms: ["ES256"],
      });

      const expectedBodyHash = payload.request_body_sha256;
      if (typeof expectedBodyHash !== "string") return false;

      const actualBodyHash = createHash("sha256").update(input.rawBody).digest("hex");
      return constantTimeEqual(actualBodyHash, expectedBodyHash);
    } catch {
      return false;
    }
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
