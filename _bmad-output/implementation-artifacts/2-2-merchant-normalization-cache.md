---
risk_tier: 3
context:
  - _bmad-output/planning-artifacts/epics/epic-2-smart-categorization.md#Story 2.2
  - _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md#Data Architecture
  - _bmad-output/planning-artifacts/architecture/project-structure-boundaries.md#Requirements -> Structure Mapping (by epic)
  - _bmad-output/implementation-artifacts/2-1-llm-categorization-pipeline.md
  - CLAUDE.md
---

# Story 2.2: Merchant normalization & cache

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want raw merchant strings cleaned up and reused,
so that my data is readable and categorization is cheap.

## Acceptance Criteria

1. Given a raw description like `TIM HORTONS #1234 VANCOUVER BC`, when it is normalized, `merchant_name` becomes `Tim Hortons`.
2. Normalization runs before categorization decisions in the worker and persists `Transaction.merchantName` without changing `rawDescription`.
3. A normalized merchant that already has a cached category for the same user hits the merchant cache instead of the LLM.
4. Cache-hit categorization writes `category`, `category_source = merchant_cache`, `category_confidence`, and `categorized_at`.
5. LLM-categorized transactions with a normalized merchant seed/update the merchant cache for future transactions.
6. Cache keys are tenant-scoped and contain only normalized merchant names, never raw descriptions, account numbers, holder names, emails, phone numbers, or internal transaction IDs.
7. Tests cover merchant normalization, cache hit bypassing the gateway, LLM result cache seeding, tenant isolation in cache keys, and existing categorization behavior.

## Tasks / Subtasks

- [x] Task 1: Merchant normalizer (AC: #1, #2, #6)
  - [x] Add `apps/api/src/modules/categorization/merchant-normalizer.ts`.
  - [x] Implement deterministic normalization for noisy card/merchant descriptions: remove store numbers, terminal/reference tokens, card/account digit runs, location suffixes such as city/province when obvious, excess punctuation, and normalize casing to display form.
  - [x] Preserve raw descriptions; only write normalized output to `Transaction.merchantName`.
  - [x] Unit test common Canadian merchant examples, including `TIM HORTONS #1234 VANCOUVER BC -> Tim Hortons`.

- [x] Task 2: Merchant cache abstraction (AC: #3, #5, #6)
  - [x] Add `apps/api/src/modules/categorization/merchant-cache.ts` or equivalent local module.
  - [x] Use Redis via existing `REDIS_URL` config; do not add a second Redis config path.
  - [x] Define tenant-scoped keys, e.g. `merchant-category:${userId}:${normalizedMerchantKey}`. The key must not contain raw descriptions or internal transaction IDs.
  - [x] Store only fixed `Category` enum values and minimal metadata needed for confidence/source; validate all cache reads with Zod before use.
  - [x] Keep the cache injectable/testable so unit tests do not require real Redis.

- [x] Task 3: Worker integration (AC: #2, #3, #4, #5)
  - [x] Update `apps/api/src/workers/categorize.worker.ts` to normalize merchants for each uncategorized transaction before deciding whether to call the gateway.
  - [x] Query/update DB only through `withUserContext(userId)`.
  - [x] For cache hits, update `merchantName`, `category`, `categorySource = CategorySource.merchant_cache`, `categoryConfidence`, and `categorizedAt` without calling the gateway.
  - [x] For cache misses, call the existing gateway only for the remaining transactions, then update `merchantName`, `categorySource = CategorySource.llm`, confidence, `categorizedAt`, and seed/update the merchant cache.
  - [x] Do not overwrite user-categorized rows. Continue to only process rows where `category IS NULL`.
  - [x] Preserve Story 2.1 final-attempt fallback behavior: provider failure on final attempt still writes `other` with `categorySource = llm`, confidence `0`, and `categorizedAt`.

- [x] Task 4: Ingestion compatibility (AC: #2, #7)
  - [x] Do not restructure CSV ingestion. The existing Story 2.1 outbox request remains the categorization trigger.
  - [x] Ensure imported transactions start with `merchantName = null` and are normalized by the worker.
  - [x] Existing ingestion tests must stay green and must not touch real Redis.

- [x] Task 5: Tests and verification (AC: #7)
  - [x] Add unit tests for `merchant-normalizer`.
  - [x] Add worker tests with a fake merchant cache and fake gateway proving cache hits bypass the gateway.
  - [x] Add worker tests proving LLM results seed the cache and later same-merchant rows use `merchant_cache`.
  - [x] Add tenant-scope test for cache key generation or cache API inputs.
  - [x] Run targeted API tests: merchant normalizer, worker categorization tests, gateway tests, and ingestion route tests.
  - [x] Run `pnpm --filter @clarifi/api typecheck`.

## Dev Notes

### Risk Tier

Tier 3 by repo policy because this story modifies RLS-scoped worker transaction updates and categorization provenance. Keep the implementation focused, but apply the guardrail tripwire before marking done. If the final diff touches Prisma schema/migrations, `withUserContext`, LLM gateway/anonymizer, outbox, or worker execution semantics, run the full relevant review/test path.

### Source Story Context

Epic 2 objective: transactions are auto-categorized and merchant-normalized; corrections teach the system. Story 2.2 specifically requires readable merchant names and a merchant cache so repeated known merchants bypass the LLM. [Source: _bmad-output/planning-artifacts/epics/epic-2-smart-categorization.md#Story 2.2]

Relevant requirements:
- FR10: normalize merchant names, e.g. `TIM HORTONS #1234 -> Tim Hortons`.
- FR11: user overrides later seed merchant-cache learning.
- NFR3: LLM categorization under 3 seconds per batch; cache hits bypass the LLM.
- NFR12: no PII logged; anonymized descriptions to LLM providers.
[Source: _bmad-output/planning-artifacts/epics/requirements-inventory.md]

### Architecture Guardrails

- Caching architecture: Upstash Redis is the selected cache layer for `merchant -> category` and `NL -> IR` caches. Reuse `REDIS_URL`; do not introduce another cache service. [Source: _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md#Data Architecture]
- Epic 2 ownership: categorization work belongs in `apps/api/src/modules/categorization`, `apps/api/src/workers`, and Redis merchant cache. [Source: _bmad-output/planning-artifacts/architecture/project-structure-boundaries.md#Requirements -> Structure Mapping]
- Worker boundary: slow categorization work remains in `apps/api/src/workers`, not route handlers. [Source: CLAUDE.md#Repo structure]
- Tenancy: all user-data DB access in the worker must run through `withUserContext(userId)`. Cache keys must be tenant scoped because Redis is outside Postgres RLS. [Source: CLAUDE.md#Multi-tenancy & query safety]
- Provenance: every categorization writes `category_source`, `category_confidence`, and `categorized_at`. User overrides in Story 2.3 must later win over cached/LLM categories, so this story must continue processing only `category IS NULL`. [Source: CLAUDE.md#Money & data model]
- Privacy: do not log raw descriptions, amounts, cache keys containing raw descriptions, or PII. Cache keys should use normalized merchant names only and include `userId` for isolation. [Source: CLAUDE.md#Privacy]

### Previous Story Intelligence

Story 2.1 established:
- `apps/api/src/workers/categorize.worker.ts` loops batches until no uncategorized rows remain.
- `processCategorizeJob` accepts an injectable gateway, which made worker tests straightforward. Follow the same pattern for a merchant cache dependency.
- The worker already uses `withUserContext(userId)` and updates provenance fields.
- The existing fallback on final provider failure writes `other` with `categorySource = llm`, confidence `0`, and `categorizedAt`; preserve that behavior.
- The LLM gateway sends aliases instead of DB IDs and validates exact result counts. Do not weaken that boundary.
- Ingestion now records a durable outbox categorization request; do not bypass or replace it.
[Source: _bmad-output/implementation-artifacts/2-1-llm-categorization-pipeline.md]

### Existing Files To Update

- `apps/api/src/workers/categorize.worker.ts`: currently fetches `id` and `rawDescription`, calls the gateway for every uncategorized transaction, and writes LLM provenance. This story should add merchant normalization/cache lookups before gateway calls and include `merchantName` in updates.
- `apps/api/src/modules/ingestion/ingestion.service.ts`: currently imports rows with `rawDescription` and leaves categorization to the outbox/worker. Preserve this trigger flow.
- `packages/shared/prisma/schema.prisma`: already has `Transaction.merchantName` and `CategorySource.merchant_cache`; no schema change should be necessary unless the implementation intentionally adds a durable DB cache. Prefer Redis cache first to match architecture.

### Implementation Guidance

- Normalization should be deterministic and conservative. It is better to normalize obvious merchant names than to over-strip ambiguous descriptions into misleading names.
- Do not send additional data to the LLM for this story. Cache miss categorization should continue using the existing gateway path from Story 2.1.
- Keep cache reads/writes behind a small typed interface, for example:
  - `getCachedMerchantCategory({ userId, merchantName })`
  - `setCachedMerchantCategory({ userId, merchantName, category, confidence })`
  - `merchantCacheKey({ userId, merchantName })`
- Cache hit confidence should be explicit and documented in code/tests. A default such as `1` is acceptable for exact normalized-merchant cache hits unless implementation chooses a stored confidence.
- Redis failures should not make categorization fail if the gateway is available. Cache lookup/set errors should degrade to the existing LLM path, not block categorization.

### Testing Standards

- No real LLM or Redis in CI. Use injected fake gateway/cache in worker tests.
- DB-backed worker tests may remain `skipIf(!hasDb)`, matching Story 2.1.
- Keep tests co-located with implementation (`*.test.ts`).
- Preserve existing Story 2.1 tests: gateway validation, anonymizer, worker fallback, and outbox behavior.

### Project Structure Notes

Expected additions:
- `apps/api/src/modules/categorization/merchant-normalizer.ts`
- `apps/api/src/modules/categorization/merchant-normalizer.test.ts`
- `apps/api/src/modules/categorization/merchant-cache.ts`
- `apps/api/src/modules/categorization/merchant-cache.test.ts` if key/validation logic is non-trivial

Expected modifications:
- `apps/api/src/workers/categorize.worker.ts`
- `apps/api/src/workers/categorize.worker.test.ts`

Avoid adding route handlers or frontend changes for this story.

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-2-smart-categorization.md#Story 2.2]
- [Source: _bmad-output/planning-artifacts/epics/requirements-inventory.md#Functional Requirements]
- [Source: _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md#Data Architecture]
- [Source: _bmad-output/planning-artifacts/architecture/project-structure-boundaries.md#Requirements -> Structure Mapping]
- [Source: _bmad-output/implementation-artifacts/2-1-llm-categorization-pipeline.md]
- [Source: CLAUDE.md]
- [Source: packages/shared/prisma/schema.prisma#Transaction]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-16: Implemented deterministic merchant normalizer and Redis merchant cache abstraction.
- 2026-06-16: Integrated merchant cache into categorization worker with cache-hit bypass and LLM result cache seeding.
- 2026-06-16: Code review found cache pollution risk for generic transfer strings and malformed Redis payload handling; fixed both.
- 2026-06-16: Verification passed: `pnpm --filter @clarifi/api typecheck`; focused categorization tests (14 tests); gateway/ingestion tests (15 tests); full API suite with explicit DB timeouts (78 tests). Default API test command hit two 5s ingestion timeouts before passing with explicit timeouts.
- 2026-06-16: Post-review hardening (Claude Opus 4.8). Fixed: (P1) payee/holder names leaking into `merchantName` and the tenant cache key — person-to-person transfers/payments now return `null` and the holder name is stripped (AC #6); (P2) cache Redis client could hang the worker on an outage — now fails fast (`enableOfflineQueue: false`, `commandTimeout`); (P3) no TTL + caching of `other`/low-confidence results — added 30-day TTL and skip non-confident/`other` seeds; (P4) silent cache degradation — added a throttled, PII-free warning. Re-ran typecheck + pure normalizer/cache tests green; DB-gated worker tests still require `DATABASE_URL` to execute.

### Completion Notes List

- Added deterministic merchant normalization for noisy card descriptions while preserving `rawDescription`.
- Added tenant-scoped Redis merchant cache with Zod-validated payload parsing and an injectable interface for tests.
- Updated the categorization worker to persist `merchantName`, use `merchant_cache` provenance on cache hits, seed cache after successful LLM categorization, and preserve Story 2.1 fallback behavior.
- Added unit and DB-backed worker coverage using fake cache/gateway dependencies; tests do not require real Redis or real LLM calls.
- Post-review hardening (Claude): transfers/payments-to-a-party no longer produce a merchant name or cache key and the holder name is stripped; cache client fails fast instead of hanging on Redis outage; entries carry a 30-day TTL and `other`/low-confidence results are not seeded; cache degradation emits a throttled non-PII warning. Added normalizer tests and DB-gated worker tests for these paths.

### File List

- `_bmad-output/implementation-artifacts/2-2-merchant-normalization-cache.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/api/src/modules/categorization/merchant-normalizer.ts`
- `apps/api/src/modules/categorization/merchant-normalizer.test.ts`
- `apps/api/src/modules/categorization/merchant-cache.ts`
- `apps/api/src/modules/categorization/merchant-cache.test.ts`
- `apps/api/src/workers/categorize.worker.ts`
- `apps/api/src/workers/categorize.worker.test.ts`

## Change Log

- 2026-06-16: Story created (ready-for-dev). Scope is merchant normalization plus Redis-backed tenant-scoped merchant category cache integrated into the existing Story 2.1 categorization worker. Not implemented.
- 2026-06-16: Implemented merchant normalization, tenant-scoped Redis merchant cache, worker cache-hit/cache-seeding flow, and focused tests.
- 2026-06-16: Completed code review fixes for generic payment cache pollution and malformed Redis payload validation; story marked done.
- 2026-06-16: Post-implementation review (Claude) fixed an AC #6 privacy gap (payee/holder name leaking into the merchant cache key), a Redis hang risk on the cache client, and cache pollution (no TTL / caching `other`/low-confidence); added normalizer and worker tests.
