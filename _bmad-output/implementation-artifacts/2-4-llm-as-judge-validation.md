---
risk_tier: 3
baseline_commit: e508ebd3b6468cbe4e8cb026f98a168e31e7da5b
context:
  - _bmad-output/planning-artifacts/epics/epic-2-smart-categorization.md#Story 2.4
  - _bmad-output/planning-artifacts/epics/requirements-inventory.md#Functional Requirements
  - _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md#Authentication & Security
  - _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md
  - _bmad-output/implementation-artifacts/2-1-llm-categorization-pipeline.md
  - apps/api/src/workers/categorize.worker.ts
  - apps/api/src/lib/llm-gateway.ts
  - CLAUDE.md
---

# Story 2.4: LLM-as-judge validation

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the system,
I want categorization output validated by a judge check,
so that low-quality or wrong LLM categorizations are caught before they are trusted, seeded into the merchant cache, or shown to the user.

## Acceptance Criteria

1. After the categorization worker obtains LLM results for cache-miss transactions, every result passes through a validation gate before the DB write. Cache hits (Story 2.2) and the error-fallback path are NOT judged.
2. **Deterministic gate (always on, no LLM):** a result whose `category` is not a member of the fixed shared `Category` enum is rejected and replaced with the fallback (`category = other`, `confidence = 0`). This is defense-in-depth — the gateway's Zod schema already enforces enum membership, so the judge must never assume a malformed value reached it, but it must also not crash on one.
3. **Deterministic gate (always on, no LLM):** a result with `confidence < CATEGORIZE_JUDGE_MIN_CONFIDENCE` (default `0.5`) is flagged as low-quality and takes the fallback path (`category = other`, `confidence = 0`, `category_source = llm`); it is excluded from merchant-cache seeding and a PII-safe flag is logged for review.
4. **LLM-as-judge second pass (only when `CATEGORIZE_JUDGE_ENABLED = true`):** for results that pass the floor but fall in the review band (`confidence < CATEGORIZE_JUDGE_REVIEW_CEILING`, default `0.8`), an independent judge check runs and returns agree / disagree (with an optional suggested category) per transaction.
5. The judge LLM pass routes **exclusively** through `apps/api/src/lib/llm-gateway.ts` and applies `anonymizeDescription` (with `holderName`) to the description before egress. No `@anthropic-ai/sdk` import is added outside the gateway. The judge sees only the anonymized description and the proposed category — never the holder name, account, or raw PII.
6. **On judge disagreement:** a structured, PII-safe record is logged for review containing only `transactionId`, proposed category, judge-suggested category, and judge confidence — never the description, `merchantName`, or holder name. The disagreed row is excluded from merchant-cache seeding. The **stored** category remains the categorizer's value (the judge advises and creates an audit trail; it does not silently overwrite the categorizer).
7. **The judge never blocks or fails categorization.** If the judge LLM call errors, the job emits a single rate-limited, PII-safe degradation notice and proceeds with the un-judged categorization (rows still committed). This mirrors the existing merchant-cache degradation behavior and the "LLM down → categorization still proceeds" guardrail.
8. Thresholds and the enable flag are environment-configurable in `apps/api/src/config.ts` with safe defaults. **Defaults keep the LLM judge OFF** (`CATEGORIZE_JUDGE_ENABLED = false`), so categorization cost and behavior are unchanged unless the judge is explicitly enabled. The always-on deterministic gate (AC #2, #3) does not depend on the enable flag.
9. Tests cover: enum-invalid rejection → fallback; below-floor → fallback + no cache seed + flag logged; judge-disabled → no second LLM call; in-band agree → result unchanged; in-band disagree → logged + no cache seed, stored category unchanged; judge-error → categorization still commits (degradation logged); cache-hit and error-fallback paths skip the judge entirely. No real LLM or Redis.

## Tasks / Subtasks

- [x] Task 1: Judge configuration & thresholds (AC: #3, #4, #8)
  - [x] Add to `apps/api/src/config.ts`: `CATEGORIZE_JUDGE_ENABLED` (coerced boolean, default `false`), `CATEGORIZE_JUDGE_MIN_CONFIDENCE` (number 0–1, default `0.5`), `CATEGORIZE_JUDGE_REVIEW_CEILING` (number 0–1, default `0.8`), and `CATEGORIZE_JUDGE_MODEL` (string, default = `CATEGORIZATION_MODEL`'s default `claude-haiku-4-5`).
  - [x] Keep the existing env-validation style: Zod coercion, sane bounds (`.min(0).max(1)`), and a short comment per field explaining the cost/quality tradeoff.
  - [x] Source the deterministic floor used by `isCacheableResult` in the worker from the same threshold (or a shared constant) so the cache-seed floor and the judge floor cannot silently drift apart. Do not change the effective `0.5` default.

- [x] Task 2: Gateway judge function (AC: #4, #5)
  - [x] Add `judgeCategorizations` to `apps/api/src/lib/llm-gateway.ts` accepting `{ id; description; holderName?; proposedCategory }[]` and returning per-item verdicts `{ id; agree: boolean; suggestedCategory?: Category; confidence: number }`.
  - [x] Reuse the existing patterns from `categorizeBatch`: `client.messages.parse` with a `zodOutputFormat` verdict schema, `item_`-prefixed aliasing via `toAlias`, duplicate/unknown-alias and count validation, and `anonymizeDescription(description, { holderName })` applied before building the prompt.
  - [x] Add a dedicated judge system prompt in `apps/api/src/modules/categorization/categorization.prompt.ts` (e.g. `CATEGORIZATION_JUDGE_SYSTEM_PROMPT`) instructing the model to assess whether the proposed category fits the description, using only the provided enum, and to never infer identity/PII.
  - [x] Use `config.CATEGORIZE_JUDGE_MODEL` for the judge call.

- [x] Task 3: Judge module (AC: #1, #2, #3, #6)
  - [x] Create `apps/api/src/modules/categorization/categorization-judge.ts` with pure logic separated from I/O:
    - a deterministic validation function that maps a `CategorizeResult` to a validated result, applying the enum guard and the confidence floor (returns the fallback `{ category: other, confidence: 0 }` when rejected, plus a flag reason).
    - a function that applies judge verdicts to results, producing the final results, the set of `transactionId`s to exclude from cache seeding, and the structured disagreement/flag records to log.
  - [x] Define PII-safe log record shapes; never include description, `merchantName`, or holder name.

- [x] Task 4: Worker integration (AC: #1, #3, #6, #7)
  - [x] In `apps/api/src/workers/categorize.worker.ts`, run the validation gate over the cache-miss `results` immediately after `gateway.categorizeBatch(...)` returns and before the DB write loop. Do not judge `cacheHits` or the `fallbackUsed` error path.
  - [x] When `CATEGORIZE_JUDGE_ENABLED`, invoke the judge (Task 2) only for in-band results; wrap the call so a judge error is swallowed with a rate-limited PII-safe warning (mirror `warnCacheDegraded`) and categorization proceeds.
  - [x] Extend the injectable dependencies on `processCategorizeJob` options with an optional `judge` (defaulting to the real gateway function), following the existing `gateway` / `merchantCache` injection convention, so tests inject fakes with no real LLM.
  - [x] Ensure rows flagged by the gate or disagreed by the judge are excluded from `cacheWrites` (extend the existing `isCacheableResult` gating; do not weaken the current `other` / `< 0.5` exclusions).
  - [x] Keep the worker's "only process `category IS NULL`" rule and the existing fallback-to-`other` behavior intact.

- [x] Task 5: Tests & verification (AC: #1–#9)
  - [x] Unit-test `categorization-judge.ts` (pure, no DB): enum guard, below-floor fallback + flag reason, in-band detection, verdict application (agree vs disagree → cache-exclusion + records).
  - [x] Add a gateway test for `judgeCategorizations` mirroring `apps/api/src/lib/llm-gateway.test.ts` with a fake Anthropic-like client (assert anonymization, aliasing, verdict mapping).
  - [x] Extend `apps/api/src/workers/categorize.worker.test.ts` (DB-backed, `hasDb` skip): below-floor result → row is `other`/0 and merchant cache untouched; judge-disabled → injected judge never called; in-band disagree → stored category unchanged, cache not seeded; judge-error → categorization still commits; cache-hit path → judge never called.
  - [x] Run `pnpm --filter @clarifi/api typecheck` and the targeted suites: judge unit, gateway, worker. If DB tests hit the 5s timeout, rerun with `--testTimeout=40000 --hookTimeout=40000`.

## Dev Notes

### Risk Tier

Tier 3. This story adds a new LLM egress call (the judge) and therefore touches a guardrail surface (`lib/llm-gateway.ts`, `lib/anonymize.ts`). Per the `CLAUDE.md` guardrail tripwire, any diff touching the LLM gateway/anonymizer gets the full Tier 3 review path. No Prisma schema change is required (see below) — if you find yourself adding one, stop and reassess: it escalates migration/RLS guardrails.

### Source Story Context

Epic 2 objective: transactions are auto-categorized and merchant-normalized; corrections teach the system. Story 2.4 closes the quality loop: an LLM-as-judge validation step catches low-quality or wrong categorizations before they are trusted or learned. [Source: _bmad-output/planning-artifacts/epics/epic-2-smart-categorization.md#Story 2.4]

Epic BDD: *Given an LLM categorization result, when the judge check runs, then results outside the allowed category set or below a confidence threshold are flagged for fallback/re-try, and judge disagreements are logged for review.* [Source: _bmad-output/planning-artifacts/epics/epic-2-smart-categorization.md#Story 2.4]

Relevant requirements:
- Categorization quality / fallback: LLM output must be validated before use; on weak/failed output the system falls back rather than committing a confident wrong guess. [Source: _bmad-output/planning-artifacts/epics/requirements-inventory.md#Functional Requirements]
- NFR3: cache hits bypass the LLM — the judge must not run on cache hits, and must not seed the cache from low-quality/disagreed results.
- NFR12: no PII logged — judge logs and the judge prompt must carry only anonymized descriptions and non-PII identifiers.

### Architecture Guardrails

- **Single LLM egress:** `apps/api/src/lib/llm-gateway.ts` is the only file that imports `@anthropic-ai/sdk`. The judge call lives here, not in the worker or the judge module. [Source: _bmad-output/implementation-artifacts/2-1-llm-categorization-pipeline.md; CLAUDE.md#Privacy]
- **Anonymize before egress:** every description sent to a provider passes through `anonymizeDescription`. [Source: apps/api/src/lib/llm-gateway.ts; CLAUDE.md#Privacy]
- **LLM output validated before use:** validate generated output with Zod at the boundary; never trust shape or range. [Source: _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md#API & Communication Patterns]
- **Detection vs explanation precedent:** the anomaly design separates deterministic checks (sync, cheap, always-on) from LLM work (optional, async, degrades gracefully). Mirror that here — the deterministic gate is always on; the LLM judge is optional and never blocks. [Source: CLAUDE.md#Anomaly detection]
- **PII-safe structured logging:** the codebase logs via plain `console.warn/error` with structured objects and no PII (e.g. `warnCacheDegraded` logs no keys or descriptions). Follow that exact convention. [Source: apps/api/src/workers/categorize.worker.ts; apps/api/src/workers/index.ts]

### Previous Story Intelligence

Story 2.1 (LLM categorization) established the structures this story extends:
- `categorizeBatch(items, client)` in `llm-gateway.ts`: `client.messages.parse` + `zodOutputFormat(BatchResultSchema)`, `item_`-prefixed aliasing (`toAlias`), and `mapAndValidateResults` enforcing unknown-alias / duplicate / count checks. Copy these idioms for `judgeCategorizations`.
- `processCategorizeJob(data, { gateway, merchantCache, fallbackOnError })` injects dependencies so tests use fakes with no real LLM/Redis. Add `judge` the same way.
- The worker already maps missing/failed results to `{ category: other, confidence: 0 }` and only retries (BullMQ `attempts`) on a thrown gateway error, falling back to `other` on the final attempt. "Re-try" in the epic AC is satisfied by this job-level retry; per-result low-quality takes the **terminal fallback** to `other` (committed, not re-looped) — do not leave rows `null`, which would cause endless reprocessing.
[Source: apps/api/src/workers/categorize.worker.ts; apps/api/src/lib/llm-gateway.ts; _bmad-output/implementation-artifacts/2-1-llm-categorization-pipeline.md]

Story 2.2 (merchant cache) established:
- `isCacheableResult` already excludes `other` and `confidence < 0.5` from cache seeding (`MERCHANT_CACHE_MIN_CONFIDENCE = 0.5`). The judge's exclusion of flagged/disagreed rows layers on top of this — extend it, do not duplicate or weaken it.
- Cache writes/reads degrade silently and non-blockingly (`safeGetCachedMerchant` / `safeSetCachedMerchant`, `warnCacheDegraded`). The judge's error handling should follow the same shape.
[Source: apps/api/src/workers/categorize.worker.ts; _bmad-output/implementation-artifacts/2-2-merchant-normalization-cache.md]

Story 2.3 (override learning) established:
- A `user` override always wins and seeds the cache with confidence 1. The judge never touches user-overridden rows — it only validates fresh `llm` results inside the worker's cache-miss path. [Source: _bmad-output/implementation-artifacts/2-3-category-override-correction-learning.md]

### Existing Files To Update

- `apps/api/src/config.ts`: add the four judge env vars with Zod coercion and bounds; mirror the existing comment style.
- `apps/api/src/lib/llm-gateway.ts`: add `judgeCategorizations` + verdict Zod schema; reuse `anonymizeDescription`, `toAlias`, and the alias/count validation idioms.
- `apps/api/src/modules/categorization/categorization.prompt.ts`: add the judge system prompt.
- `apps/api/src/workers/categorize.worker.ts`: integrate the gate + judge between `categorizeBatch` and the DB write; add the `judge` injectable; extend cache-seed exclusion.
- `apps/api/src/workers/categorize.worker.test.ts`: add judge scenarios.
- `apps/api/src/lib/llm-gateway.test.ts`: add `judgeCategorizations` coverage.

No Prisma schema change should be necessary. "Flagged for review" is satisfied by PII-safe structured logs, not a DB column. `Transaction` already has all provenance fields; the fallback path reuses existing `category`/`categorySource`/`categoryConfidence` semantics. [Source: packages/shared/prisma/schema.prisma#Transaction]

### Implementation Guidance

- Suggested gateway signature:
  - `judgeCategorizations(items: { id: string; description: string; holderName?: string | null; proposedCategory: Category }[], client?): Promise<JudgeVerdict[]>`
  - `JudgeVerdict = { id: string; agree: boolean; suggestedCategory?: Category; confidence: number }`
- Suggested judge module API (pure):
  - `validateResult(result: CategorizeResult): { result: CategorizeResult; flagged: boolean; reason?: "invalid_category" | "below_confidence" }`
  - `applyJudgeVerdicts(results, verdicts): { results: CategorizeResult[]; excludeFromCache: Set<string>; disagreements: JudgeDisagreementLog[] }`
- Order of operations in the worker: `categorizeBatch` → deterministic gate (all results) → (if enabled) LLM judge on in-band results → DB write → cache seed (excluding flagged + disagreed).
- Conservative disagreement policy (default): **keep** the categorizer's stored category, **suppress** cache seeding for that row, and **log** the disagreement. The judge advises; it does not overwrite. (See open question below if a different policy is desired.)
- Cost control: the LLM judge defaults OFF and, when on, runs only on the in-band confidence range — not on every transaction — keeping NFR3's cheap-categorization goal intact.

### Testing Standards

- No real Anthropic SDK and no real Redis in tests. Inject a fake `gateway`, `judge`, and `merchantCache`.
- Worker tests are DB-backed and use the existing `hasDb` skip pattern (`DATABASE_URL` absent/placeholder → skipped); reuse `seedTransaction` and `makeMemoryMerchantCache` from `categorize.worker.test.ts`.
- Gateway/judge unit tests use a fake `AnthropicLike` client exactly as `llm-gateway.test.ts` does; assert anonymization is applied (no raw PII in the prompt) and alias mapping round-trips.
- Pure judge-module tests need no DB and should be exhaustive on the branch logic (enum guard, floor, band boundaries, agree/disagree).
- If default API tests hit the 5s DB timeout, rerun with `pnpm --filter @clarifi/api exec vitest run --testTimeout=40000 --hookTimeout=40000`.

### Project Structure Notes

Expected additions:
- `apps/api/src/modules/categorization/categorization-judge.ts`
- `apps/api/src/modules/categorization/categorization-judge.test.ts`

Expected modifications:
- `apps/api/src/config.ts`
- `apps/api/src/lib/llm-gateway.ts` (+ `llm-gateway.test.ts`)
- `apps/api/src/modules/categorization/categorization.prompt.ts`
- `apps/api/src/workers/categorize.worker.ts` (+ `categorize.worker.test.ts`)

Avoid: frontend work, schema migrations, NL→IR/SQL, and any second `@anthropic-ai/sdk` import.

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-2-smart-categorization.md#Story 2.4]
- [Source: _bmad-output/planning-artifacts/epics/requirements-inventory.md#Functional Requirements]
- [Source: _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md#API & Communication Patterns]
- [Source: _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md]
- [Source: _bmad-output/implementation-artifacts/2-1-llm-categorization-pipeline.md]
- [Source: _bmad-output/implementation-artifacts/2-2-merchant-normalization-cache.md]
- [Source: _bmad-output/implementation-artifacts/2-3-category-override-correction-learning.md]
- [Source: CLAUDE.md]
- [Source: apps/api/src/workers/categorize.worker.ts]
- [Source: apps/api/src/lib/llm-gateway.ts]
- [Source: apps/api/src/lib/anonymize.ts]
- [Source: apps/api/src/modules/categorization/categorization.prompt.ts]
- [Source: apps/api/src/config.ts]
- [Source: packages/shared/prisma/schema.prisma#Transaction]

## Pre-Review Due Diligence

**Complete this self-review before marking the story for review.** This repo's code review runs three lenses — Blind Hunter (context-free bugs), Edge Case Hunter (boundaries), Acceptance Auditor (AC coverage). Pre-empt them here so review finds little:

- **AC → test traceability (Acceptance Auditor):** every AC #1–#9 maps to at least one named test. List the AC→test mapping in the Completion Notes. No AC ships without a test.
- **Guardrail tripwire (mandatory, Tier 3):** run `git diff --name-only`. This story's expected guardrail surface is **LLM egress (`lib/llm-gateway.ts`, `lib/anonymize.ts`)** — confirm in the record that (a) no second `@anthropic-ai/sdk` import was added, (b) the judge prompt only ever receives `anonymizeDescription(...)` output, and (c) no description/`merchantName`/holder name appears in any log. If the diff unexpectedly touches money/`_cents`, RLS/`withUserContext` writes, idempotency keys, `prisma/migrations`, or outbox/cursor code, stop — that is out of scope for this story.
- **Edge / failure paths (Edge Case Hunter):** enumerate and test — enum-invalid result, below-floor confidence, review-band boundaries (`< ceiling` vs `>=`), judge disabled (no second LLM call), judge LLM error (categorization still commits, degradation logged once), empty batch, and the cache-hit / error-fallback paths skipping the judge entirely.
- **Reuse first (Blind Hunter / simplify):** reuse `anonymizeDescription`, `toAlias` + the alias/count validation idioms, `isCacheableResult`, `warnCacheDegraded`, and the `gateway`/`merchantCache` injection pattern. Do not duplicate them or weaken the existing `other`/`< 0.5` cache-seed exclusions.
- **Scope discipline:** touch only the files in *Existing Files To Update* / *Project Structure Notes*. Flag any out-of-scope edit with a one-line rationale.
- **Evidence, not claims:** run the commands in *Testing Standards* and paste actual results (typecheck clean + pass counts for judge-unit, gateway, and worker suites) into the Completion Notes. Do not mark done on "looks complete."

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-16: Added judge env config and shared confidence threshold for cache seed and validation floor.
- 2026-06-16: Added pure `categorization-judge` validation and verdict application module.
- 2026-06-16: Added `judgeCategorizations` to the LLM gateway with alias mapping, Zod parsing, and anonymized prompt construction.
- 2026-06-16: Integrated deterministic validation and optional LLM judge into cache-miss worker flow before DB writes.
- 2026-06-16: Code review pass found no unresolved Story 2.4 issues. Subagent layers were not launched because the active tool rules only permit delegation when explicitly requested; the same Blind Hunter, Edge Case Hunter, and Acceptance Auditor lenses were applied locally.

### Completion Notes List

- Implemented the always-on deterministic gate: invalid categories and below-floor confidence fall back to `Category.other` with confidence `0`, source `llm`, and no merchant-cache seed.
- Implemented optional LLM-as-judge: default off, only runs for results with `confidence >= CATEGORIZE_JUDGE_MIN_CONFIDENCE` and `< CATEGORIZE_JUDGE_REVIEW_CEILING`.
- Judge disagreements keep the categorizer's stored value, log only `transactionId`, proposed/suggested categories, and judge confidence, and suppress cache seeding.
- Judge failures are non-blocking and rate-limited; categorization rows still commit.
- AC traceability:
  - AC1: `processCategorizeJob > does not call the judge for merchant-cache hits`, `processCategorizeJob > falls back to other on final gateway failure`, worker cache-miss judge tests.
  - AC2: `categorization judge > falls back on out-of-enum categories without throwing`.
  - AC3: `categorization judge > falls back and flags below-floor confidence`; `processCategorizeJob > falls back to other and logs when LLM confidence is below the judge floor`.
  - AC4: `categorization judge > passes valid above-floor results and selects only review-band results`; worker judge enabled agree/disagree/error tests.
  - AC5: `llm-gateway > sends only anonymized descriptions and aliases to the judge`; `rg` guardrail confirmed `@anthropic-ai/sdk` imports remain only in `apps/api/src/lib/llm-gateway.ts`.
  - AC6: `processCategorizeJob > keeps the categorizer category but suppresses cache seeding on judge disagreement`.
  - AC7: `processCategorizeJob > continues committing categorization when the judge call fails`.
  - AC8: `pnpm --filter @clarifi/api typecheck` verifies config types; defaults keep judge disabled.
  - AC9: targeted and full suites listed below cover all named paths with fake LLM/Redis dependencies.
- Verification:
  - `pnpm --filter @clarifi/api typecheck` passed.
  - `pnpm --filter @clarifi/api exec vitest run src/modules/categorization/categorization-judge.test.ts src/lib/llm-gateway.test.ts --testTimeout=20000 --hookTimeout=20000` passed: 2 files, 14 tests.
  - `set -a; source .env; set +a; pnpm --filter @clarifi/api exec vitest run src/workers/categorize.worker.test.ts --testTimeout=40000 --hookTimeout=40000` passed: 1 file, 16 tests.
  - `set -a; source .env; set +a; pnpm --filter @clarifi/api exec vitest run src/modules/auth/auth.routes.test.ts --testTimeout=90000 --hookTimeout=90000` passed: 1 file, 16 tests. This rerun confirmed the earlier full-suite auth failure was a 40s timeout sensitivity.
  - `set -a; source .env; set +a; pnpm --filter @clarifi/api exec vitest run --testTimeout=90000 --hookTimeout=90000` passed: 14 files, 106 tests.
- Guardrail evidence: no schema/migration changes; no second Anthropic SDK import; judge prompts are built through `anonymizeDescription`; new judge logs contain no description, `merchantName`, or holder name.
- All test commands emitted the existing Node engine warning: package wants Node `>=20.19`, current shell is Node `v20.16.0`.

### File List

- `_bmad-output/implementation-artifacts/2-4-llm-as-judge-validation.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/api/src/config.ts`
- `apps/api/src/lib/llm-gateway.ts`
- `apps/api/src/lib/llm-gateway.test.ts`
- `apps/api/src/modules/categorization/categorization.prompt.ts`
- `apps/api/src/modules/categorization/categorization-judge.ts`
- `apps/api/src/modules/categorization/categorization-judge.test.ts`
- `apps/api/src/workers/categorize.worker.ts`
- `apps/api/src/workers/categorize.worker.test.ts`

## Change Log

- 2026-06-16: Story created (ready-for-dev). Scope is a validation gate plus an optional LLM-as-judge second pass over categorization output, with PII-safe disagreement logging and graceful degradation. No schema change. Not implemented.
- 2026-06-16: Implemented Story 2.4, completed code review, applied review-level coverage/config hardening, and marked done after targeted and full API verification passed.
