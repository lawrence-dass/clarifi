---
risk_tier: 3
baseline_commit: e508ebd3b6468cbe4e8cb026f98a168e31e7da5b
context:
  - _bmad-output/planning-artifacts/epics/epic-2-smart-categorization.md#Story 2.3
  - _bmad-output/planning-artifacts/epics/requirements-inventory.md#Functional Requirements
  - _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md#API & Communication Patterns
  - _bmad-output/planning-artifacts/architecture/project-structure-boundaries.md#Requirements -> Structure Mapping (by epic)
  - _bmad-output/implementation-artifacts/2-2-merchant-normalization-cache.md
  - CLAUDE.md
---

# Story 2.3: Category override & correction learning

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to correct a wrong category,
so that future similar transactions are right.

## Acceptance Criteria

1. Given an authenticated user owns a categorized transaction, when they submit a valid category override, the transaction updates to the requested fixed `Category` enum value.
2. The override writes `category_source = user`, `category_confidence = 1`, and `categorized_at` to the current time.
3. The override is scoped through `withUserContext(userId)` so users cannot read or update another user's transaction, even if they know the transaction id.
4. If the transaction has a normalized `merchantName`, the override seeds/updates the tenant-scoped merchant cache with the user-confirmed category.
5. If the transaction has no `merchantName` but has `rawDescription`, the service attempts deterministic normalization with the existing normalizer and persists the resulting `merchantName` before seeding cache.
6. Subsequent uncategorized transactions for the same normalized merchant use the user-confirmed merchant cache category through the existing Story 2.2 worker path.
7. Invalid categories are rejected with the existing Zod/error contract; unauthenticated requests return 401; non-owned or missing transactions do not leak ownership.
8. Tests cover successful override, cache seeding, later worker cache hit, invalid category validation, unauthenticated rejection, and tenant isolation.

## Tasks / Subtasks

- [x] Task 1: Override API contract (AC: #1, #2, #7)
  - [x] Add a Zod request body schema accepting only the fixed shared `Category` enum.
  - [x] Add an authenticated route under the existing `/transactions` router, e.g. `PATCH /transactions/:transactionId/category`.
  - [x] Return a minimal transaction category payload: `id`, `category`, `categorySource`, `categoryConfidence`, `categorizedAt`, and `merchantName`.
  - [x] Reuse the central error contract; do not return raw Prisma errors.

- [x] Task 2: RLS-scoped override service (AC: #1, #2, #3, #5)
  - [x] Add a transaction-category override service in `apps/api/src/modules/categorization` or a small `transactions` module if route ownership is clearer.
  - [x] Use `withUserContext(userId)` for the transaction lookup and update.
  - [x] Look up the transaction by id inside the user context; return 404-style not found for missing or non-owned rows without disclosing ownership.
  - [x] Update `category`, `categorySource = CategorySource.user`, `categoryConfidence = 1`, and `categorizedAt = new Date()`.
  - [x] Preserve `rawDescription`, `amountCents`, `direction`, `currency`, and account/idempotency fields.
  - [x] If `merchantName` is null, call `normalizeMerchantName(rawDescription)` and persist only the normalized value if non-null.

- [x] Task 3: Merchant cache learning (AC: #4, #5, #6)
  - [x] Reuse the existing `MerchantCategoryCache` interface from `merchant-cache.ts`; do not create a second Redis client or cache key scheme.
  - [x] Seed/update cache with `{ userId, merchantName, category, confidence: 1 }` after a successful user override.
  - [x] Keep cache injectable for tests; no real Redis in route/service tests.
  - [x] Treat cache write failure as non-blocking after the DB override succeeds, consistent with Story 2.2 worker behavior.
  - [x] Ensure cache keys use normalized merchant names only and remain tenant-scoped.

- [x] Task 4: Worker compatibility and precedence (AC: #6)
  - [x] Do not change the worker's rule that only `category IS NULL` rows are processed.
  - [x] Add or update a worker test proving a later uncategorized same-merchant transaction uses the user-seeded cache and gets `categorySource = merchant_cache`.
  - [x] Add a regression test that user-overridden rows are not overwritten by the worker.

- [x] Task 5: Route tests and verification (AC: #1-#8)
  - [x] Add Supertest coverage for authenticated override success.
  - [x] Add Supertest coverage for invalid category, unauthenticated request, missing transaction, and cross-user transaction id.
  - [x] Assert DB row provenance fields and merchant cache fake state after override.
  - [x] Run targeted API tests: new override route/service tests, merchant cache tests, worker categorization tests, and ingestion route tests.
  - [x] Run `pnpm --filter @clarifi/api typecheck`.

## Dev Notes

### Risk Tier

Tier 3. This story updates user-owned financial rows and provenance fields under RLS, and it writes tenant-scoped Redis learning state. Before marking done, run the guardrail tripwire from `CLAUDE.md`; if the diff touches schema/migrations, `withUserContext`, ingestion idempotency, LLM gateway/anonymizer, or worker execution semantics, keep the full Tier 3 review path.

### Source Story Context

Epic 2 objective: transactions are auto-categorized and merchant-normalized; corrections teach the system. Story 2.3 requires a user correction to override existing categorization, record user provenance, and teach the merchant cache for future similar transactions. [Source: _bmad-output/planning-artifacts/epics/epic-2-smart-categorization.md#Story 2.3]

Relevant requirements:
- FR11: users can override a transaction's category; the system records provenance and learns via merchant cache.
- NFR3: cache hits bypass the LLM, so user-seeded merchant cache should improve later categorization speed.
- NFR8: multi-tenancy is DB-enforced through RLS.
- NFR12: no PII logged; do not log transaction descriptions, account data, or cache keys with raw descriptions.
[Source: _bmad-output/planning-artifacts/epics/requirements-inventory.md]

### Architecture Guardrails

- API pattern: Express REST with Zod validation at every boundary and central JSON error envelope `{ error: { code, message, details? } }`. [Source: _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md#API & Communication Patterns]
- Epic 2 ownership: categorization logic belongs in `apps/api/src/modules/categorization`, `apps/api/src/workers`, and Redis merchant cache. [Source: _bmad-output/planning-artifacts/architecture/project-structure-boundaries.md#Requirements -> Structure Mapping (by epic)]
- Route mounting: `/transactions` already exists and is currently owned by `apps/api/src/modules/ingestion/ingestion.routes.ts`; adding a category override endpoint there is acceptable if it remains small, or split a transactions router only if needed to avoid clutter. [Source: apps/api/src/app.ts]
- Tenancy: all user-data DB reads/writes must run through `withUserContext(userId)`; do not rely on application-only `where: { userId }` checks as the enforcement mechanism. [Source: CLAUDE.md#Multi-tenancy & query safety]
- Provenance: a `user` override always wins and seeds the merchant cache. The categorization worker must not overwrite non-null/user categories. [Source: CLAUDE.md#Money & data model]
- Redis cache: reuse `REDIS_URL` and the existing `merchant-category:${userId}:${normalizedMerchantKey}` pattern. Redis is outside Postgres RLS, so tenant scoping in the key is mandatory. [Source: _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md#Data Architecture]

### Previous Story Intelligence

Story 2.2 established:
- `apps/api/src/modules/categorization/merchant-normalizer.ts` exports `normalizeMerchantName(rawDescription)` and `merchantNameKey(merchantName)`.
- `apps/api/src/modules/categorization/merchant-cache.ts` exports `MerchantCategoryCache`, `redisMerchantCategoryCache`, `merchantCategoryCacheKey`, and validated payload parsing.
- The worker accepts an injectable `merchantCache`, swallows cache get/set failures, and updates rows only where `category: null`.
- Cache-hit categorization writes `categorySource = merchant_cache`; LLM categorization seeds cache only after successful DB update.
- Code review fixed cache pollution from generic payment-only strings and malformed Redis payload handling. Preserve both safeguards.
[Source: _bmad-output/implementation-artifacts/2-2-merchant-normalization-cache.md]

Story 2.1 established:
- Categorization provenance fields are always populated when the system categorizes a row.
- Worker tests are DB-backed and skip when `DATABASE_URL` is absent/placeholder.
- The gateway/anonymizer path should not be touched for this story.
[Source: _bmad-output/implementation-artifacts/2-1-llm-categorization-pipeline.md]

### Existing Files To Update

- `apps/api/src/modules/ingestion/ingestion.routes.ts`: currently mounts `POST /transactions/import` with `requireAuth`; likely place to add `PATCH /:transactionId/category` unless a new transactions router is introduced.
- `apps/api/src/modules/ingestion/ingestion.controller.ts`: use as the controller pattern for parsing Zod input and passing errors to `next`.
- `apps/api/src/modules/categorization/merchant-cache.ts`: reuse the interface and Redis-backed implementation; inject a fake cache in tests.
- `apps/api/src/modules/categorization/merchant-normalizer.ts`: reuse for transactions that lack `merchantName`.
- `apps/api/src/workers/categorize.worker.ts`: avoid broad changes; only test or minimally adjust if needed to prove user-overridden rows remain untouched.
- `apps/api/src/app.ts`: only update if route organization changes.

No Prisma schema change should be necessary. `Transaction` already has `merchantName`, `category`, `categorySource`, `categoryConfidence`, and `categorizedAt`; `CategorySource.user` already exists. [Source: packages/shared/prisma/schema.prisma#Transaction]

### Implementation Guidance

- Suggested service signature:
  - `overrideTransactionCategory(input: { userId: string; transactionId: string; category: Category; merchantCache?: MerchantCategoryCache }): Promise<OverrideCategoryResult>`
- Suggested endpoint:
  - `PATCH /transactions/:transactionId/category`
  - Body: `{ "category": "food_and_dining" }`
- Suggested response:
  - `{ id, category, categorySource, categoryConfidence, categorizedAt, merchantName }`
- Use `z.nativeEnum(Category)` from `@clarifi/shared` for body validation.
- Keep not-found behavior ownership-neutral. A non-owned transaction id should produce the same response as a missing id.
- Cache writes should happen after the DB override succeeds. If the cache write fails, the request should still return success because the user's correction was persisted.
- Do not enqueue categorization from this endpoint. This story teaches future worker runs through the merchant cache; it does not recategorize historical rows in bulk.

### Testing Standards

- No real Redis in CI. Inject a fake `MerchantCategoryCache`.
- No real LLM in these tests.
- Route tests should follow `apps/api/src/modules/ingestion/ingestion.routes.test.ts`: register/login via Supertest, use auth cookies, and clean created users in `afterAll`.
- DB-backed tests should use the existing `hasDb` skip pattern.
- Include one worker-level integration proving the cache seeded by a user override is compatible with Story 2.2's worker cache-hit path.
- If default API tests hit the known 5s DB timeout, rerun with explicit timeouts: `pnpm --filter @clarifi/api exec vitest run --testTimeout=20000 --hookTimeout=20000`.

### Project Structure Notes

Expected additions:
- `apps/api/src/modules/categorization/category-override.service.ts`
- `apps/api/src/modules/categorization/category-override.controller.ts` or equivalent if keeping route/controller separation
- `apps/api/src/modules/categorization/category-override.routes.test.ts`

Expected modifications:
- `apps/api/src/modules/ingestion/ingestion.routes.ts` or a new route composition under `/transactions`
- `apps/api/src/workers/categorize.worker.test.ts`

Avoid frontend work, schema migrations, and LLM prompt/gateway changes for this story.

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-2-smart-categorization.md#Story 2.3]
- [Source: _bmad-output/planning-artifacts/epics/requirements-inventory.md#Functional Requirements]
- [Source: _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md#API & Communication Patterns]
- [Source: _bmad-output/planning-artifacts/architecture/project-structure-boundaries.md#Requirements -> Structure Mapping (by epic)]
- [Source: _bmad-output/implementation-artifacts/2-2-merchant-normalization-cache.md]
- [Source: CLAUDE.md]
- [Source: packages/shared/prisma/schema.prisma#Transaction]
- [Source: apps/api/src/app.ts]
- [Source: apps/api/src/modules/ingestion/ingestion.routes.ts]
- [Source: apps/api/src/modules/categorization/merchant-cache.ts]
- [Source: apps/api/src/modules/categorization/merchant-normalizer.ts]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-16: Implemented authenticated `PATCH /transactions/:transactionId/category` with Zod body/param validation and central error handling.
- 2026-06-16: Added RLS-scoped override service using `withUserContext(userId)`; writes `CategorySource.user`, confidence `1`, current `categorizedAt`, and normalized `merchantName`.
- 2026-06-16: Added non-blocking merchant-cache seeding through the existing `MerchantCategoryCache` interface.
- 2026-06-16: Added route and worker tests for override success, cache seeding, cache failure degradation, later cache hit, user precedence, invalid input, unauthenticated access, missing/non-owned ids, and unsafe person-transfer descriptions.
- 2026-06-16: BMAD review found a stale merchant-name cache-safety gap; fixed by recomputing merchant names from `rawDescription` through the normalizer and clearing rejected descriptions before cache seeding.
- 2026-06-16: Verification passed: `pnpm --filter @clarifi/api typecheck`; focused override route tests (9 tests); broader relevant categorization/ingestion tests (37 tests); full API suite with explicit DB timeouts (93 tests). A prior 20s full-suite run hit a DB-latency timeout and passed with 40s timeouts.

### Completion Notes List

- Added a focused category override controller and service under `modules/categorization`, mounted on the existing `/transactions` router.
- Overrides are ownership-neutral for missing/non-owned ids, preserve immutable transaction/account/idempotency fields, and record user provenance.
- Merchant-cache learning runs only after the DB override succeeds, uses tenant-scoped normalized merchant names, and does not fail the request if cache write fails.
- User-seeded cache behavior is compatible with the existing worker path, and user-overridden rows are not overwritten because the worker still only processes `category IS NULL`.
- Review hardening prevents stale person names in `merchantName` from being propagated into Redis cache keys.

### File List

- `_bmad-output/implementation-artifacts/2-3-category-override-correction-learning.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/api/src/lib/app-error.ts`
- `apps/api/src/modules/categorization/category-override.controller.ts`
- `apps/api/src/modules/categorization/category-override.routes.test.ts`
- `apps/api/src/modules/categorization/category-override.service.ts`
- `apps/api/src/modules/ingestion/ingestion.routes.ts`
- `apps/api/src/workers/categorize.worker.test.ts`

## Code Review

- 2026-06-16: BMAD code review completed. Subagent launch was blocked by the session agent limit, so the main agent applied the same blind, edge-case, and acceptance-audit review lenses locally.
- Finding fixed: existing stale/unsafe `merchantName` values could have been reused for merchant-cache seeding even when `rawDescription` would now be rejected by the normalizer. The service now recomputes the normalized merchant from `rawDescription`, clears rejected merchant names, and has a regression route test for stale person-transfer names.
- Remaining findings: none after fixes and verification.

## Change Log

- 2026-06-16: Story created (ready-for-dev). Scope is authenticated transaction category override, user provenance, and merchant-cache learning. Not implemented.
- 2026-06-16: Implemented override endpoint/service, merchant-cache learning, worker compatibility tests, route coverage, and BMAD review fix; story marked done.
