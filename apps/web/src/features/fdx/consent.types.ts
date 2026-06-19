export interface Consent {
  id: string;
  scopes: string[];
  status: "granted" | "revoked";
  grantedAt: string;
  revokedAt: string | null;
}

export interface ConsentsResult {
  consents: Consent[];
}
