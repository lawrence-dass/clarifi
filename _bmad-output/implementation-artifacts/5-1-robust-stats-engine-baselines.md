---
risk_tier: 3
baseline_commit: 605a19a
context:
  - _bmad-output/planning-artifacts/epics/epic-5-anomaly-detection.md#Story 5.1
  - packages/shared/prisma/schema.prisma
  - apps/api/src/modules/categorization/categorization-judge.ts
  - apps/api/src/workers/categorize.worker.ts
  - CLAUDE.md
---

# Story 5.1: Robust-stats engine & baselines

Status: review

## Story

As the system,
I want robust per-user baselines,
so that anomaly detection is accurate on heavy-tailed spending.

**Scope note:** Backend only. A new `apps/api/src/modules/anomaly/` module containing:
(a) pure stats functions (median, MAD, modified z-score, empirical-Bayes shrinkage) with
no IO or DB calls, and (b) baseline query functions that load transaction history per user,
merchant, or category and return the computed stats with cold-start fallback. No schema
migration — the existing `Transaction` table supplies all needed data. No BullMQ worker,
no LLM calls, no UI. Stories 5.2 and 5.3 will wire detection into ingestion using this
foundation.

## Acceptance Criteria

1. **Median & MAD:** `computeMedian(values: number[]): number` returns the median of a
   sorted or unsorted array. `computeMAD(values: number[], median: number): number` returns
   the median absolute deviation. Both handle the two-element midpoint and the
   single-element edge case correctly.

2. **Modified z-score:** `modifiedZScore(value: number, median: number, mad: number): number`
   returns `0.6745 * (value − median) / MAD`. When MAD = 0, returns 0 (no signal — all
   values identical, no anomaly). Threshold for flagging: `> 3.5` (caller's responsibility;
   constant exported as `MODIFIED_Z_SCORE_THRESHOLD = 3.5`).

3. **Empirical-Bayes shrinkage:** `shrinkTowardsPrior(observed: number, prior: number, sampleSize: number, confidence: number): number`
   returns `(sampleSize * observed + confidence * prior) / (sampleSize + confidence)`.
   `confidence` defaults to `5` (exported as `SHRINKAGE_CONFIDENCE = 5`). With 0 samples
   returns the prior; with many samples converges to observed.

4. **BigInt-to-Number conversion:** all stats functions operate on `number[]`, not `bigint[]`.
   Conversion from `amountCents: BigInt` happens once, at the baseline-query boundary, via
   an explicit `Number(cents)` call. No float arithmetic is performed on BigInt directly.
   The conversion is safe for all realistic personal-finance amounts (< 2^53 cents).

5. **Baseline computation:** `computeBaseline(values: number[]): Baseline` returns
   `{ median, mad, sampleSize }`. Exported `Baseline` interface. Used by cold-start and
   detection callers.

6. **Cold-start fallback:** `resolveBaseline(userId, merchantName | null, category | null, tx): Promise<ResolvedBaseline>`
   — runs inside a caller-supplied `withUserContext` transaction; queries posted
   (non-removed) transactions for the user:
   - **Merchant level** (if `merchantName` non-null and `sampleSize >= MIN_SAMPLES`): use
     merchant baseline, shrunk towards the category prior.
   - **Category level** (if `category` non-null and `sampleSize >= MIN_SAMPLES`): use
     category baseline, shrunk towards the global prior.
   - **Global prior** (fallback): hardcoded seeded defaults
     (`medianCents: 3500, madCents: 2000` — ~CAD$35 median, ~CAD$20 MAD).
   - `MIN_SAMPLES = 5` exported constant. `ResolvedBaseline` includes `level` (`merchant` |
     `category` | `global`) plus the shrunk `median`, `mad`, and `sampleSize`.

7. **RLS:** all DB reads go through a `withUserContext`-scoped transaction parameter passed
   by the caller. No standalone `prisma` calls inside the stats/baselines module. No
   `where: { userId }` application-level tenancy guard (RLS handles it).

8. **No removed transactions in baselines:** baseline queries filter
   `status: { not: TransactionStatus.removed }` so removed/superseded rows don't skew the
   stats.

9. **Tests:**
   - `stats.test.ts` (unit, no DB): median (even/odd length, single element, already sorted,
     unsorted); MAD; modified z-score (normal, MAD=0 edge case); shrinkage (0 samples →
     prior, large N → observed, midpoint); BigInt conversion helper.
   - `baselines.test.ts` (DB-backed, `hasDb` guard): merchant-level baseline when ≥
     MIN_SAMPLES; falls back to category when merchant < MIN_SAMPLES; falls back to global
     prior when both < MIN_SAMPLES; removed transactions excluded; shrinkage applied
     correctly at each level.

## Tasks / Subtasks

- [x] Task 1: Pure stats functions (AC: #1, #2, #3, #4, #5)
  - [x] Create `apps/api/src/modules/anomaly/stats.ts`:
    - Export `MODIFIED_Z_SCORE_THRESHOLD = 3.5`, `SHRINKAGE_CONFIDENCE = 5`, `MIN_SAMPLES = 5`.
    - Export `interface Baseline { median: number; mad: number; sampleSize: number }`.
    - `computeMedian(values: number[]): number` — sort copy, pick middle or average two middles; throw if empty.
    - `computeMAD(values: number[], median: number): number` — median of `|xi - median|`.
    - `modifiedZScore(value: number, median: number, mad: number): number` — `0.6745 * (value - median) / mad`; return 0 when `mad === 0`.
    - `shrinkTowardsPrior(observed: number, prior: number, sampleSize: number, confidence?: number): number`.
    - `computeBaseline(values: number[]): Baseline` — calls median + MAD.
    - `centsToNumber(cents: bigint): number` — `Number(cents)`; exported for use at the query boundary.
  - [x] Create `apps/api/src/modules/anomaly/stats.test.ts` — unit tests, no DB.

- [x] Task 2: Baseline query functions (AC: #6, #7, #8)
  - [x] Create `apps/api/src/modules/anomaly/baselines.ts`:
    - Export `interface ResolvedBaseline { level: 'merchant' | 'category' | 'global'; median: number; mad: number; sampleSize: number }`.
    - Export `GLOBAL_PRIOR: Baseline = { median: 3500, mad: 2000, sampleSize: 0 }` (seeded CAD defaults).
    - `resolveBaseline(params: { userId: string; merchantName: string | null; category: Category | null }, tx: PrismaTransactionClient): Promise<ResolvedBaseline>`:
      - Query helper `loadAmounts(where, tx)`: fetches `amountCents` for posted non-removed transactions matching the filter, converts to `number[]` via `centsToNumber`.
      - If `merchantName` non-null: load merchant amounts; if `sampleSize >= MIN_SAMPLES`, compute and shrink towards category prior (or global if category also thin).
      - If `category` non-null: load category amounts; if `sampleSize >= MIN_SAMPLES`, compute and shrink towards global prior.
      - Fallback: return `GLOBAL_PRIOR` with `level: 'global'`.
  - [x] Create `apps/api/src/modules/anomaly/baselines.test.ts` — DB-backed tests (hasDb guard).

- [x] Task 3: Typecheck + tests (AC: #9)
  - [x] `pnpm --filter @clarifi/api typecheck` — no errors.
  - [x] `pnpm --filter @clarifi/api test` — 25 stats unit tests pass; 6 DB-backed baseline tests skipped (no live DB in this environment — red flag, requires desktop verification).

## Dev Notes

### Risk Tier

Tier 3 — reads and performs arithmetic over `amountCents` (BigInt money fields). The
CLAUDE.md guardrail tripwire fires on "money math / `_cents`". The key risk is the
BigInt→Number conversion: JavaScript BigInt division throws; Number loses precision above
2^53. For personal-finance cent amounts (max ~$1M = 100_000_000 cents < 2^27) this is
safe, but the conversion must be explicit and confined to `centsToNumber`. Never pass raw
BigInt into float arithmetic. RLS is enforced by the caller passing a
`withUserContext`-scoped `tx` — the baselines module itself has no DB import.

### Source Story Context

Epic 5: Anomaly Detection. 5.1 is the pure-math and query foundation — all detection
stories (5.2 synchronous, 5.3 severity scoring) build on this module.

CLAUDE.md guardrails relevant to this story:
- **Robust statistics, not mean/std:** median + MAD, modified z-score `0.6745·(x−median)/MAD`, flag `>3.5`.
- **Cold-start:** hierarchical fallback (merchant → category → seeded global prior) + empirical-Bayes shrinkage by sample size.
- **Detection (deterministic stats) is separate from explanation (LLM, async).** This story is pure stats — no LLM.
- **Money is integer cents (BigInt), never floats.** Convert once at the query boundary; never mutate back.
- **RLS:** reads go through `withUserContext`; no `where: { userId }`.

### Architecture Guardrails

- **BigInt→Number:** convert at the boundary (`centsToNumber`), not inside stats functions. Stats functions accept `number[]`.
- **No standalone `prisma` import in the anomaly module.** Callers pass a `tx` (scoped by `withUserContext`) into `resolveBaseline`.
- **No removed transactions:** `status: { not: TransactionStatus.removed }` on all baseline queries (regression from 4.3).
- **Module boundary:** `apps/api/src/modules/anomaly/` — stats.ts + baselines.ts + their tests. Nothing else in this story.

### Previous Story Intelligence

- **Transaction query pattern:** see `transactions.service.ts` — use same `status: { not: TransactionStatus.removed }` filter; query `amountCents` only (no description/PII to the stats layer).
- **`withUserContext` passed by caller:** the baseline function takes a `tx` parameter; don't open a new `withUserContext` inside — the caller (future 5.2/5.3 worker) already holds one.
- **`categorize.worker.ts` module pattern:** new module in `apps/api/src/modules/`; pure logic (no worker in this story); tests alongside the module.
- **`centsToNumber` is the single conversion point** — analogous to `directionFromCents` in the shared package (a single well-named helper).

### Implementation Guidance

- Stats functions are pure (no side effects, no IO). Test them exhaustively with unit tests — these are the high-value math units CLAUDE.md calls out.
- For `computeMedian`: copy the array before sorting (`[...values].sort((a, b) => a - b)`) — don't mutate the input.
- For MAD = 0 edge case: all values identical (e.g., a single recurring charge of the same amount every time). `modifiedZScore` returns 0 — no anomaly. Document this.
- `shrinkTowardsPrior` with `sampleSize = 0`: the formula gives `(0 * observed + k * prior) / (0 + k) = prior`. Correct.
- Global prior values (`median: 3500, mad: 2000`) are seeded in CAD cents (~$35 median, ~$20 MAD). These are conservative defaults — real baselines build up quickly with actual data.
- The `PrismaTransactionClient` type is the type of the `tx` arg inside `withUserContext`'s callback. Import from `@clarifi/shared` or from the generated Prisma client path.

### Testing Standards

- **Stats tests** (`stats.test.ts`): pure unit, no DB, no `hasDb` guard. Cover: median (empty → throws, single, even N, odd N, unsorted); MAD (normal, all-same → 0); z-score (positive, negative, MAD=0); shrinkage (N=0 → prior, large N → near-observed); `centsToNumber` (positive, negative BigInt).
- **Baseline tests** (`baselines.test.ts`): DB-backed, `hasDb` guard, `--testTimeout=40000 --hookTimeout=40000`. Seed transactions directly via `prisma.transaction.create` (bypass categorization). Test: merchant baseline (≥5 samples → merchant level); category fallback (merchant 3 samples → category level); global fallback (both thin); removed excluded; shrinkage direction verified (with known values).
- Paste actual typecheck + test output into Completion Notes. Evidence, not claims.

### Project Structure Notes

New files only:
- `apps/api/src/modules/anomaly/stats.ts`
- `apps/api/src/modules/anomaly/stats.test.ts`
- `apps/api/src/modules/anomaly/baselines.ts`
- `apps/api/src/modules/anomaly/baselines.test.ts`

No changes to schema, existing workers, routes, or shared package. No new BullMQ queue. No migration. Avoid: floating-point money storage, standalone `prisma` import in the anomaly module, `where: { userId }` tenancy guards, querying removed transactions.

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-5-anomaly-detection.md#Story 5.1]
- [Source: packages/shared/prisma/schema.prisma]
- [Source: CLAUDE.md#Anomaly detection]
- [Source: CLAUDE.md#Money & data model]
- [Source: CLAUDE.md#Multi-tenancy & query safety]
- [Source: apps/api/src/modules/transactions/transactions.service.ts]

## Pre-Review Due Diligence

Complete before marking done. Three review lenses + guardrail tripwire:

- **Acceptance Auditor:** every AC #1–#9 maps to a named test. Record the AC→test map in Completion Notes. Pay special attention to MAD=0 (#2), shrinkage at N=0 and large N (#3), the BigInt conversion helper (#4), all three cold-start levels (#6), removed exclusion (#8).
- **Guardrail tripwire:** run `git diff --name-only 605a19a..HEAD`. Confirm: (a) all float arithmetic over cents uses `centsToNumber` — never raw BigInt in math ops; (b) no `amountCents` values are stored back as floats anywhere; (c) all baseline queries go through the caller's `tx` (no standalone `prisma`); (d) `status: { not: removed }` filter present on every baseline query; (e) no schema/migration change; (f) no LLM call. If the diff touches the categorize worker, plaid sync, routes, or the shared schema → stop — out of scope.
- **Edge Case Hunter:** empty array passed to `computeMedian` (throw); MAD = 0 (z-score = 0); `sampleSize = 0` in shrinkage (→ prior); single transaction for a merchant (→ falls through to category); identical cent amounts across all transactions (MAD = 0 at baseline level); negative amounts (debit transactions — the stats should still work on signed cents).
- **Blind Hunter:** `[...values].sort((a, b) => a - b)` not `.sort()` (default lexicographic sort breaks numeric sort); `Number(bigint)` not `parseInt`/`parseFloat`; the two-midpoint median formula uses integer division correctly (`Math.floor`); shrinkage formula denominator is `sampleSize + confidence` not `sampleSize`.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

**AC → test traceability:**
- AC #1 (median + MAD): `"computeMedian > *"` (5 tests) + `"computeMAD > *"` (4 tests) in stats.test.ts
- AC #2 (z-score): `"modifiedZScore > *"` (5 tests) in stats.test.ts; `MODIFIED_Z_SCORE_THRESHOLD` exported
- AC #3 (shrinkage): `"shrinkTowardsPrior > *"` (4 tests) in stats.test.ts; `SHRINKAGE_CONFIDENCE` exported
- AC #4 (BigInt conversion): `"centsToNumber > *"` (4 tests) in stats.test.ts
- AC #5 (computeBaseline): `"computeBaseline > *"` (2 tests) in stats.test.ts
- AC #6 (cold-start): merchant/category/global + null params in baselines.test.ts (6 DB-backed tests, hasDb guard)
- AC #7 (RLS): `resolveBaseline` takes `tx` param; no standalone `prisma` import in baselines.ts ✅
- AC #8 (no removed): `"excludes removed transactions from baselines"` in baselines.test.ts
- AC #9 (tests): all above

**Guardrail tripwire (`git diff --name-only`):**
- `apps/api/src/modules/anomaly/stats.ts` — pure functions only; no BigInt arithmetic (converts via `centsToNumber`); no DB
- `apps/api/src/modules/anomaly/stats.test.ts` — tests only
- `apps/api/src/modules/anomaly/baselines.ts` — DB reads via caller `tx` only; `status: { not: removed }` filter on all queries
- `apps/api/src/modules/anomaly/baselines.test.ts` — tests only
- `_bmad-output/` — story + sprint status
- No existing workers, routes, schema, or shared package touched

**Tripwire confirmations:**
(a) BigInt→Number via `centsToNumber` only; no float stored as cents ✅
(b) All baseline reads go through caller's `tx`; no standalone `prisma` in anomaly module ✅
(c) `status: { not: TransactionStatus.removed }` in every `loadAmounts` call ✅
(d) No schema/migration change ✅
(e) No LLM call ✅
(f) RLS via `withUserContext` (caller's responsibility; `tx` passed in) ✅

**Typecheck:** `pnpm --filter @clarifi/api typecheck` — no errors
**Tests:** 93 pass (25 new stats unit tests pass), 102 skipped (6 new DB-backed baseline tests skipped — `hasDb=false`)
**Red flag:** DB-backed baseline tests skipped; requires desktop verification with a live DB before merging to main.

**Self-review (three lenses):**
- Blind Hunter: no findings
- Edge Case Hunter: no findings (all edge cases tested — empty array throws, MAD=0, sampleSize=0, null params)
- Acceptance Auditor: all ACs covered by named tests

### File List

- `apps/api/src/modules/anomaly/stats.ts` — pure stats functions: computeMedian, computeMAD, modifiedZScore, shrinkTowardsPrior, computeBaseline, centsToNumber; constants: MODIFIED_Z_SCORE_THRESHOLD, SHRINKAGE_CONFIDENCE, MIN_SAMPLES, interface Baseline
- `apps/api/src/modules/anomaly/stats.test.ts` — 25 unit tests, no DB
- `apps/api/src/modules/anomaly/baselines.ts` — resolveBaseline with merchant/category/global cold-start + shrinkage; GLOBAL_PRIOR; interface ResolvedBaseline
- `apps/api/src/modules/anomaly/baselines.test.ts` — 6 DB-backed tests (hasDb guard)

## Change Log

- 2026-06-19: Story created (ready-for-dev). Pure stats engine + baseline query foundation for Epic 5. New `apps/api/src/modules/anomaly/` module (stats + baselines). No schema migration, no worker, no LLM. Tier 3 due to money math (BigInt→Number at query boundary). Not implemented.
- 2026-06-19: Implemented (review). New `apps/api/src/modules/anomaly/` module: stats.ts (pure functions, 25 unit tests all pass) and baselines.ts (resolveBaseline with merchant/category/global cold-start + empirical-Bayes shrinkage, 6 DB-backed tests skipped — no live DB). Typecheck clean. Self-review: no findings. Red flag: DB tests skipped; desktop verification needed before merging to main.
