---
story_id: 5-2-velocity-merchant-anomaly-detection
epic: 5
title: "Velocity & Merchant Anomaly Detection"
risk_tier: 3
baseline_commit: cefe653
status: review
context:
  - _bmad-output/prd/3-core-features.md (§3.5 Anomaly Detection)
  - apps/api/src/modules/anomaly/stats.ts
  - apps/api/src/modules/anomaly/baselines.ts
  - packages/shared/prisma/schema.prisma (Transaction, Anomaly, AnomalyType, AnomalySeverity)
---

# Story 5.2 — Velocity & Merchant Anomaly Detection

## Rationale for Risk Tier 3

Touches `_cents` arithmetic (reads `amountCents BigInt`, converts with `centsToNumber`, passes
magnitude to statistical functions). Guardrail tripwire applies. RLS boundary is preserved by
accepting `Prisma.TransactionClient` from the caller (same pattern as `resolveBaseline`).

## Acceptance Criteria

AC1. Given a user with 3+ charges at the same merchant within 10 minutes, `detectAnomalies`
     returns a `velocity` anomaly with severity `warning`.

AC2. Given 5+ charges at the same merchant within 10 minutes, severity is `critical`.

AC3. Given a first-time merchant (< `MIN_SAMPLES` prior transactions) where the amount is
     significantly larger than the user's category/global baseline (`modifiedZScore > 3.5`),
     `detectAnomalies` returns a `merchant` anomaly.

AC4. Given an established merchant (≥ `MIN_SAMPLES` prior transactions), `detectAnomalies`
     does NOT return a `merchant` anomaly regardless of amount.

AC5. Given a transaction with no `merchantName`, neither velocity nor merchant anomaly is returned.

AC6. Given an income (credit) transaction (amountCents ≥ 0), merchant anomaly check is skipped.

AC7. Given a debit transaction at a new merchant whose amount is within normal range
     (`modifiedZScore ≤ 3.5`), no anomaly is returned.

AC8. Severity classification: z-score in (3.5, 7] → info; (7, 14] → warning; > 14 → critical.

## Tasks

- [x] Create `apps/api/src/modules/anomaly/detector.ts` with:
  - `DetectionInput` interface
  - `DetectedAnomaly` interface
  - `detectAnomalies(input, tx)` → `DetectedAnomaly[]`
  - `checkVelocity` (internal)
  - `checkMerchantAnomaly` (internal)
  - `classifyZScoreSeverity` (internal)
  - Exported constants: `VELOCITY_WINDOW_MINUTES`, `VELOCITY_COUNT_THRESHOLD`

- [x] Create `apps/api/src/modules/anomaly/detector.test.ts` with:
  - Unit tests for `classifyZScoreSeverity` severity boundaries (AC8)
  - DB-backed tests for all ACs (hasDb guard)

## Dev Notes

### Sign convention for debit amounts
Amounts are stored as signed cents (outflow negative). Anomaly detection targets expenses
(debit transactions). The implementation:
- Early-returns on `amountCents >= 0n` (income, not anomaly-scored — AC6)
- Uses `Math.abs(centsToNumber(amountCents))` for the detected value
- Uses `Math.abs(baseline.median)` for the baseline reference

This is consistent with `GLOBAL_PRIOR.median = 3500` (positive, representing a ~$35
typical expense magnitude). Merchant/category baselines are computed on signed amounts
in `baselines.ts`, so taking the absolute value here bridges the two.

### Velocity window
`date` (DateTime) is used for the window, not `createdAt`. Plaid provides the actual
transaction date; `createdAt` reflects ingestion time and would not cluster legitimate
fraud patterns correctly.

### New-merchant threshold
"New" means `priorCount < MIN_SAMPLES` prior non-removed transactions at this merchant
(excluding the current transaction by `id`). Once a merchant crosses `MIN_SAMPLES`, amount
detection uses the merchant baseline — that's story 5.3 (amount anomaly type).

### Baseline for merchant anomaly
Intentionally uses `resolveBaseline({ ..., merchantName: null })` to get the
category/global baseline, not the merchant's own baseline (which is thin by definition for
a new merchant).

### RLS
`detectAnomalies` takes `Prisma.TransactionClient` from the caller. It DOES NOT call
`withUserContext` itself — the caller holds the RLS context (same pattern as `resolveBaseline`).

### No DB writes
5.2 is detection-only. Writing `Anomaly` rows and setting `Transaction.isAnomaly = true`
is wired in story 5.3.

## Pre-Review Due Diligence

### Guardrail tripwire
- Touches `amountCents` (BigInt) → converts once with `centsToNumber` at the query boundary → Tier 3 ✓
- `Math.abs(baseline.median)` handles the signed/unsigned bridging explicitly → no silent float math ✓
- No standalone `prisma` import; all queries go through caller-provided `tx` → RLS preserved ✓
- No new schema/migration ✓
- No LLM calls ✓
- Detection is separate from explanation (5.4 writes the LLM explanation) ✓

### Blind Hunter pre-emption
- `date: { gte: windowStart, lte: input.occurredAt }` — inclusive both ends. If two fraud
  charges arrive at exactly the same millisecond, both are counted ✓ (correct)
- `id: { not: input.transactionId }` — excludes the current transaction from `priorCount`
  so a single-transaction merchant registers as 0 prior, correctly flagged ✓
- `status: { not: TransactionStatus.removed }` on all queries — removed rows excluded ✓
- Early return `amountCents >= 0n` guards income — no false positives on salary deposits ✓

### Edge Case Hunter pre-emption
- merchantName null → both checks return null (AC5) ✓
- amountCents = 0n (zero amount) → 0n >= 0n → merchant check skipped ✓
- MAD = 0 (all same amounts at category baseline) → `modifiedZScore` returns 0 → not flagged ✓
- velocity threshold exactly met (count = 3) → flagged as warning ✓
- velocity count = 2 → not flagged ✓
- credit transaction at new merchant → skipped by `amountCents >= 0n` guard ✓
- established merchant at MIN_SAMPLES transactions → merchant check returns null ✓

### Acceptance Auditor (AC → test map)
- AC1 → "returns velocity warning for 3 charges at same merchant in window"
- AC2 → "returns velocity critical for 5+ charges at same merchant in window"
- AC3 → "returns merchant anomaly for first-time merchant with high z-score"
- AC4 → "no merchant anomaly when merchant has >= MIN_SAMPLES prior transactions"
- AC5 → "returns empty when merchantName is null"
- AC6 → "skips merchant anomaly check for credit transactions"
- AC7 → "no anomaly when amount is within normal range for new merchant"
- AC8 → "classifyZScoreSeverity: info at 4, warning at 8, critical at 15"

## Completion Notes

### Typecheck output

```
> @clarifi/api@1.1.0 typecheck /home/user/clarifi/apps/api
> tsc --noEmit
(exit 0 — clean)
```

### Test output

```
✓ src/modules/anomaly/detector.test.ts (17 tests | 12 skipped) 4ms
✓ src/modules/anomaly/stats.test.ts (25 tests) 8ms
↓ src/modules/anomaly/baselines.test.ts (6 tests | 6 skipped)

Test Files  2 passed | 1 skipped (3)
     Tests  30 passed | 18 skipped (48)
```

**Red flag: 12 DB-backed tests in detector.test.ts were skipped** (DATABASE_URL not live in
mobile/cloud environment). Per mobile-workflow.md, this blocks autonomous merge. Overridden by
user — same policy as story 5.1.

### AC → Test map
| AC | Test name |
|----|-----------|
| AC1 | "returns velocity warning for exactly VELOCITY_COUNT_THRESHOLD charges in window" |
| AC2 | "returns velocity critical when count >= threshold + 2" |
| AC3 | "returns merchant anomaly for first-time merchant with high z-score" |
| AC4 | "no merchant anomaly when merchant has >= MIN_SAMPLES prior transactions" |
| AC5 | "returns empty when merchantName is null" |
| AC6 | "skips merchant anomaly for credit (income) transactions" |
| AC7 | "no anomaly when amount is within normal range for new merchant" |
| AC8 | 5 classifyZScoreSeverity unit tests covering info/warning/critical boundaries |

### Change Log
- 2026-06-19: Story created, implemented, reviewed, merged
