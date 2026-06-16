/**
 * Best-effort transaction-description anonymization before LLM egress.
 *
 * Raw bank descriptions are messy and provider-specific, so this intentionally
 * focuses on high-risk obvious PII: account/card-like digit runs, direct contact
 * information, address-like strings, Interac/e-transfer names, and an optional
 * account holder name supplied by a provider profile flow.
 */
export function anonymizeDescription(
  raw: string,
  options: { holderName?: string | null } = {},
): string {
  let value = raw;
  const holderName = options.holderName?.trim();
  if (holderName) {
    value = value.replace(new RegExp(escapeRegExp(holderName), "gi"), "[NAME]");
  }

  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL]")
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, "[PHONE]")
    .replace(/\b[A-Z]\d[A-Z][ -]?\d[A-Z]\d\b/gi, "[POSTAL_CODE]")
    .replace(/\b\d{1,6}\s+(?:[A-Z0-9.'-]+\s+){0,5}(?:ST|STREET|AVE|AVENUE|RD|ROAD|DR|DRIVE|BLVD|LANE|LN|COURT|CT)\b/gi, "[ADDRESS]")
    .replace(
      /\b((?:INTERAC|E-?TRANSFER|ETRANSFER|EMAIL MONEY TRANSFER).*?\b(?:FROM|TO)\s+)([A-Z][A-Z.'-]+(?:\s+[A-Z][A-Z.'-]+){1,3})\b/gi,
      "$1[NAME]",
    )
    .replace(
      /\b((?:FROM|TO)\s+)([A-Z][A-Z.'-]+(?:\s+[A-Z][A-Z.'-]+){1,3})(?=\s+(?:E-?TRANSFER|ETRANSFER|TRANSFER)\b)/gi,
      "$1[NAME]",
    )
    .replace(/\b\d(?:[ -]?\d){11,18}\b/g, "[ACCOUNT]")
    .replace(/\b\d{6,}\b/g, "[ACCOUNT]")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
