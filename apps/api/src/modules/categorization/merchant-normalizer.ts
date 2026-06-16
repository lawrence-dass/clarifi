const KNOWN_BRANDS: Array<[RegExp, string]> = [
  [/\bTIM\s+HORTONS?\b/i, "Tim Hortons"],
  [/\bSTARBUCKS\b/i, "Starbucks"],
  [/\bMCDONALD'?S\b/i, "McDonald's"],
  [/\bA\s*&?\s*W\b/i, "A&W"],
  [/\bUBER\s+EATS\b/i, "Uber Eats"],
  [/\bUBER\b/i, "Uber"],
  [/\bWALMART\b/i, "Walmart"],
  [/\bCOSTCO\b/i, "Costco"],
  [/\bAMAZON\b/i, "Amazon"],
  [/\bPAYROLL\b/i, "Payroll"],
];

const CITY_PROVINCE_SUFFIX =
  /\b(?:VANCOUVER|VICTORIA|BURNABY|SURREY|RICHMOND|TORONTO|OTTAWA|MISSISSAUGA|MONTREAL|CALGARY|EDMONTON|WINNIPEG|HALIFAX|REGINA|SASKATOON)\s+(?:BC|ON|QC|AB|MB|NS|NB|NL|PE|SK|YT|NT|NU)\b$/i;
const GENERIC_PAYMENT_ONLY = /^(?:TRANSFER|PAYMENT|INTERAC|E\s*TRANSFER|ETRANSFER|EMAIL MONEY TRANSFER)$/i;

// Person-to-person transfers/payments are not merchants. These patterns carry a
// payee/sender name (often a real person), so we must never derive a merchant name
// or cache key from them — that would put a name in Transaction.merchantName and the
// tenant Redis key (AC #6 / PIPEDA). Detect them up front and return null instead.
const PERSON_TRANSFER = /\b(?:INTERAC|E-?TRANSFER|ETRANSFER|EMAIL\s+MONEY\s+TRANSFER|E-?TFR|EMT)\b/i;
const TRANSFER_TO_PARTY = /\b(?:TRANSFER|PAYMENT|SEND|WITHDRAWAL|DEPOSIT)\b.*\b(?:TO|FROM)\s+[A-Z][A-Za-z.'-]+/i;

export function normalizeMerchantName(
  rawDescription: string,
  options: { holderName?: string | null } = {},
): string | null {
  if (PERSON_TRANSFER.test(rawDescription) || TRANSFER_TO_PARTY.test(rawDescription)) {
    return null;
  }

  // Strip the account holder's own name as defense in depth before normalizing.
  const holderName = options.holderName?.trim();
  const source = holderName
    ? rawDescription.replace(new RegExp(escapeRegExp(holderName), "gi"), " ")
    : rawDescription;

  let value = source
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, " ")
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, " ")
    .replace(/\b\d(?:[ -]?\d){11,18}\b/g, " ")
    .replace(/\b(?:POS|POINT OF SALE|PURCHASE|DEBIT|VISA|MASTERCARD|MC|CARD|PREAUTH|AUTHORIZED|AUTH)\b/gi, " ")
    .replace(/\b(?:REF|TRACE|AUTH|APPR|APPROVAL|TERMINAL|TERM|TID|STORE|STN)\s*#?\s*[A-Z0-9-]+\b/gi, " ")
    .replace(/#\s*\d+\b/g, " ")
    .replace(/\b[A-Z]{2,4}\d{3,}\b/gi, " ")
    .replace(CITY_PROVINCE_SUFFIX, " ")
    .replace(/\b(?:BC|ON|QC|AB|MB|NS|NB|NL|PE|SK|YT|NT|NU|CAN|CANADA)\b$/gi, " ")
    .replace(/[*_~|,;:()[\]{}]+/g, " ")
    .replace(/[-/]+/g, " ")
    .replace(/\b\d{4,}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!value) return null;

  for (const [pattern, merchant] of KNOWN_BRANDS) {
    if (pattern.test(value)) return merchant;
  }

  value = value.replace(/\b\d+\b/g, " ").replace(/\s+/g, " ").trim();
  if (!value) return null;
  if (GENERIC_PAYMENT_ONLY.test(value)) return null;
  return titleCase(value);
}

export function merchantNameKey(merchantName: string): string {
  return merchantName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-CA")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function titleCase(value: string): string {
  return value
    .toLocaleLowerCase("en-CA")
    .split(" ")
    .map((word) => {
      if (word === "td" || word === "rbc" || word === "bmo" || word === "cibc") return word.toUpperCase();
      return word.charAt(0).toLocaleUpperCase("en-CA") + word.slice(1);
    })
    .join(" ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
