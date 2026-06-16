---
context:
  - _bmad-output/planning-artifacts/epics/epic-2-smart-categorization.md#Story 2.1
  - _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md
  - CLAUDE.md
---

# Story 2.1: LLM categorization pipeline

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want my transactions automatically categorized,
so that I understand my spending without manual tagging.

## Acceptance Criteria

1. A **BullMQ queue + worker** categorizes **uncategorized** transactions (`category IS NULL`) in **batches**. After a CSV import (Story 1.4/1.5), the ingestion path **enqueues** a categorize job for the affected account; the worker is a long-running process separate from the HTTP server.
2. Each categorized transaction gets a `category` from the **fixed `Category` enum**, `category_source = llm`, a `category_confidence` (0–1), and `categorized_at`. The LLM's output is **Zod-validated against the enum before any DB write** — an out-of-set or malformed category is rejected (never trusted raw).
3. **Only anonymized descriptions** are sent to the provider: the account holder's name and account/card numbers are stripped before egress. **All provider calls go through the single LLM gateway** (`lib/llm-gateway`) — the only egress to Claude; nothing else imports the Anthropic SDK.
4. **Graceful degradation:** on an LLM/provider failure the job **retries** (BullMQ backoff); when retries are exhausted the batch **falls back to `category = other`** (with `category_source = llm`, `confidence = 0`, `categorized_at` set) so transactions are never stuck uncategorized and **ingestion is never blocked**.
5. **Tenancy + cost:** every DB read/write in the worker runs through `withUserContext(userId)` (the job carries the userId); descriptions are batched into few LLM calls (≤ N per request) to control cost. No PII is logged.
6. Tested: the gateway with a **mocked Anthropic SDK** (valid parse, out-of-enum rejected, anonymization applied); the categorize logic with a **fake gateway** (maps results → provenance fields; fallback on throw); a DB-gated worker/integration test for the enqueue→process→update path (Redis-gated or driven by calling the processor directly). Existing tests pass; `pnpm -r typecheck` clean.

## Tasks / Subtasks

- [x] Task 0: Decisions to confirm before coding (see **Decisions to confirm** in Dev Notes) — categorization **model** (default `claude-haiku-4-5`), **batch size**, **worker topology**.
- [x] Task 1: Config + deps (AC: #1, #3)
  - [x] Add `REDIS_URL` and `ANTHROPIC_API_KEY` support to `apps/api/src/config.ts`; add `CATEGORIZATION_MODEL` (default `claude-haiku-4-5`) and `CATEGORIZE_BATCH_SIZE` (default `25`).
  - [x] Deps (gated): `bullmq`, `ioredis`, `@anthropic-ai/sdk`. Installed and verified against local SDK types.
- [x] Task 2: Anonymizer (AC: #3) — `apps/api/src/lib/anonymize.ts`
  - [x] `anonymizeDescription(raw, { holderName? }): string` — strip holder name and redact card/account-like digit runs. Pure + unit-tested.
- [x] Task 3: LLM gateway (AC: #2, #3) — `apps/api/src/lib/llm-gateway.ts`
  - [x] The **only** file importing `@anthropic-ai/sdk`. `categorizeBatch(items: { id: string; description: string }[]): Promise<{ id: string; category: Category; confidence: number }[]>`.
  - [x] Use `client.messages.parse({ model: config.CATEGORIZATION_MODEL, max_tokens, messages, output_config: { format: zodOutputFormat(BatchResultSchema) } })`; Zod-validate before returning; reject out-of-range confidence, unknown ids, duplicate ids, and missing results; prompt template separated.
  - [x] Send only anonymized descriptions at the gateway boundary. Never log descriptions.
- [x] Task 4: Queue + worker (AC: #1, #4, #5) — `apps/api/src/queues/` + `apps/api/src/workers/`
  - [x] `queues/categorize.queue.ts`: BullMQ `Queue` named `categorize.transaction`; `enqueueCategorize({ userId, accountId, holderName? })` with `attempts: 3`, exponential `backoff`, `removeOnComplete`.
  - [x] `workers/categorize.worker.ts`: processor loads `category IS NULL` transactions through `withUserContext`, calls gateway, and updates provenance fields; final-attempt fallback writes `other`.
  - [x] `workers/index.ts` + `src/worker.ts` bootstraps the BullMQ worker; added `pnpm --filter @clarifi/api worker` script.
- [x] Task 5: Wire ingestion → enqueue (AC: #1) — `apps/api/src/modules/ingestion/ingestion.service.ts`
  - [x] After successful import, record a durable outbox request and asynchronously dispatch `enqueueCategorize({ userId, accountId })`; Redis hiccup does not fail import; response unchanged and the worker drains unprocessed requests.
- [x] Task 6: Tests + verify (AC: #6)
  - [x] `anonymize.test.ts` (pure): names, digit runs, direct contact details, address-like text, and e-transfer names redacted; safe text preserved.
  - [x] `llm-gateway.test.ts`: valid parse returns mapped results; out-of-enum category is rejected; out-of-range confidence is rejected; aliases prevent internal DB ids from leaving the service; missing/duplicate results fail closed; prompt contains only anonymized text.
  - [x] `categorize.worker.test.ts`: fake gateway asserts provenance writes, optional holder-name propagation, multi-batch processing, and `other` fallback. DB-gated; Redis not required.
  - [x] `categorize.outbox.test.ts`: Redis enqueue failure leaves a durable unprocessed outbox request; drain retries and marks processed.
  - [x] `pnpm -r typecheck` + `pnpm -r test` green (no real LLM/Redis calls in CI).

## Dev Notes

### ⚠️ Decisions to confirm (flagged — this story introduces major new infra)
1. **Categorization model.** Per the `claude-api` reference, structured outputs are supported on `claude-opus-4-8`, `claude-sonnet-4-6`, and `claude-haiku-4-5`. Categorization is **high-volume, simple classification**, and the architecture caps LLM cost ($0–7/mo, "controlled via merchant cache"). **Recommendation: default `claude-haiku-4-5`** ($1/$5 per MTok) — make it env-configurable (`CATEGORIZATION_MODEL`) so it can be bumped to `claude-sonnet-4-6`/`claude-opus-4-8` for accuracy. (CLAUDE.md says "default to the most capable model" — flagging the cost/accuracy tradeoff for your call.)
2. **Worker topology.** A **separate `src/worker.ts` entrypoint** (own process, `pnpm … worker`) vs. booting workers inside `server.ts`. Recommendation: separate process (matches the "worker tier" the architecture mandates; Render runs api + worker). Confirm.
3. **Batch size** (`CATEGORIZE_BATCH_SIZE`, default 25) — how many descriptions per LLM request. Bigger = cheaper/fewer calls but larger prompts; 25 is a safe start.

### Guardrails this story is the FIRST to exercise
- **AI boundary (CLAUDE.md / architecture.md:230):** `lib/llm-gateway` is the **only** egress to Claude. Nothing else imports `@anthropic-ai/sdk`. The gateway **anonymizes** input and **Zod-validates** output (no raw trust). The LLM has no DB/SQL authority.
- **Provenance (CLAUDE.md):** set `category_source` (`llm`), `category_confidence`, `categorized_at` on every categorized row. A future `user` override (Story 2.3) will win and seed the merchant cache (Story 2.2) — leave room for that; do not overwrite a non-null `category_source = user`.
- **PIPEDA (CLAUDE.md):** only anonymized descriptions leave the system; **never log** raw descriptions, amounts, internal transaction IDs, or PII. The pino logger is already `silent` in test.
- **Async, never blocking (architecture.md:33-34):** categorization is async on the worker tier. Ingestion enqueues and returns immediately; an LLM outage degrades to `other`, never blocks an import or a webhook ack.
- **Tenancy:** the worker runs outside a request, so it has no `req.userId` — the **job payload carries `userId`**, and every DB op uses `withUserContext(userId)`. The base/admin client must not be used for user data here.
- **LLM output validation (architecture.md:173):** parse, don't trust raw output — enum-validate each result, reject malformed confidence, reject unknown/duplicate/missing aliases, and fail closed so BullMQ retries.

### Claude SDK specifics (from the `claude-api` reference — verify against the installed version)
- Client: `import Anthropic from "@anthropic-ai/sdk"; const client = new Anthropic();` (reads `ANTHROPIC_API_KEY` from env).
- Structured outputs (recommended): `client.messages.parse({ model, max_tokens, messages, output_config: { format: zodOutputFormat(Schema) } })` → `response.parsed_output` (may be `null` if the model refused — guard it). `zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod`. Note JSON-schema limits: numeric/string constraints (min/max) are stripped + validated client-side, so enforce `confidence` range and enum membership in Zod after parsing.
- For a cheap classifier, **no extended/adaptive thinking** and a small `max_tokens` — keep it fast. Do not set `temperature`/`top_p` on 4.x models (removed → 400). Use a typed `try/catch` on `Anthropic.APIError` and let it propagate so BullMQ retries.

### Reuse — do NOT recreate
- **`Category` / `CategorySource` enums** are in the schema/`@clarifi/shared` — import, don't redefine. **No schema change / no migration** (provenance columns already exist).
- **`withUserContext`** ([packages/shared/src/prisma.ts]) for all worker DB access.
- **Error contract** + config patterns from `apps/api`. **`config.ts`** already validates env at boot — extend it (don't add a second config path).
- **Ingestion service** ([apps/api/src/modules/ingestion/ingestion.service.ts]) is where the enqueue hook goes — append after the existing insert, don't restructure it.

### Testing standards
- **No real LLM or Redis in CI.** Mock `@anthropic-ai/sdk` in the gateway test (`vi.mock("@anthropic-ai/sdk")`); inject a fake gateway into the worker logic (keep the processor a pure-ish function taking a gateway dependency so it's unit-testable). DB-touching tests `skipIf(!hasDb)`; if a Redis integration test is added, gate it on `REDIS_URL`. `.npmrc` `workspace-concurrency=1` keeps shared-DB suites serial.
- Co-located `*.test.ts`, Vitest. Clean up created users (cascade) in `afterAll`.

### Project Structure Notes
New: `apps/api/src/lib/{anonymize,llm-gateway}.ts`, `apps/api/src/modules/categorization/categorization.prompt.ts` (prompt template), `apps/api/src/queues/categorize.queue.ts`, `apps/api/src/workers/{categorize.worker,index}.ts` (+ `src/worker.ts` entrypoint), tests alongside. Modified: `apps/api/src/config.ts`, `apps/api/src/modules/ingestion/ingestion.service.ts`, `apps/api/package.json` (deps + `worker` script). Matches architecture.md:208-219 (`queues/`, `workers/`, `lib/llm-gateway`).

### References
- [Source: _bmad-output/planning-artifacts/epics/epic-2-smart-categorization.md#Story 2.1] (ACs)
- [Source: _bmad-output/planning-artifacts/architecture.md] (LLM gateway = only egress, anonymized + Zod-validated; BullMQ 5.71; async never blocks; dot.case queue names; Upstash Redis; merchant/IR caches for cost)
- [Source: CLAUDE.md] (AI guardrails; provenance fields; PIPEDA anonymization + no PII logs; workers in apps/api not route handlers; latest Claude model via the claude-api skill)
- [Source: packages/shared/prisma/schema.prisma] (Category, CategorySource enums; Transaction.category/categorySource/categoryConfidence/categorizedAt)
- [Source: packages/shared/src/prisma.ts] (withUserContext for worker DB access)
- [Source: claude-api skill] (current model ids; `messages.parse` + `zodOutputFormat` structured outputs; 4.x param removals)

## Dev Agent Record

### Agent Model Used

### Debug Log References

- 2026-06-16: Installed `bullmq`, `ioredis`, and `@anthropic-ai/sdk`; inspected installed SDK types and selected `messages.parse` + `zodOutputFormat`.
- 2026-06-16: Initial typecheck found BullMQ/ioredis minor type mismatch; switched to BullMQ connection options with `url`.
- 2026-06-16: Focused tests found ingestion was waiting on dummy Redis DNS; initial direct enqueue was changed to fail fast, then later replaced with durable outbox-backed dispatch after review.
- 2026-06-16: `pnpm -r typecheck` passed.
- 2026-06-16: Focused categorization and ingestion tests passed.
- 2026-06-16: Initial `pnpm -r test` passed: shared 26 tests, API 58 tests.
- 2026-06-16: Code review self-pass found single-batch-only processing; patched processor to loop until no uncategorized rows remain.
- 2026-06-16: Blind review found holder-name anonymization context was not carried into the gateway and confidence was clamped instead of rejected; patched both.
- 2026-06-16: Edge review found internal DB IDs were sent to the LLM, partial LLM results were accepted, Redis enqueue failure had no durable retry path, anonymization was too narrow, and worker lifecycle lacked shutdown handling; patched all.
- 2026-06-16: Acceptance review found holder-name propagation was not wired through the worker job path and ingestion tests could touch Redis when `REDIS_URL` was present; patched with optional job holder names and mocked ingestion dispatch tests.
- 2026-06-16: Final verification passed: `pnpm --filter @clarifi/api typecheck`, focused gateway/anonymizer tests, focused DB-backed worker/outbox tests, and `pnpm -r test` (shared 26 tests, API 68 tests).

### Completion Notes List

- Implemented the single Anthropic gateway boundary with anonymization and Zod-validated structured output.
- Added BullMQ categorize queue, worker entrypoint, and RLS-scoped processor with final-attempt `other` fallback.
- Wired CSV ingestion to a durable categorization outbox that dispatches to Redis asynchronously and retries from the worker process.
- Hardened LLM egress by redacting common PII, using per-request aliases instead of transaction IDs, and requiring exactly one valid result per input.
- Added tests for anonymization, gateway validation/anonymized prompt/aliasing, direct worker processor updates/fallback, outbox retry behavior, and existing ingestion behavior.

### File List

- .env.example
- apps/api/package.json
- apps/api/src/config.ts
- apps/api/src/lib/anonymize.ts
- apps/api/src/lib/anonymize.test.ts
- apps/api/src/lib/llm-gateway.ts
- apps/api/src/lib/llm-gateway.test.ts
- apps/api/src/modules/categorization/categorization.prompt.ts
- apps/api/src/modules/ingestion/ingestion.service.ts
- apps/api/src/modules/ingestion/ingestion.routes.test.ts
- apps/api/src/queues/categorize.outbox.ts
- apps/api/src/queues/categorize.outbox.test.ts
- apps/api/src/queues/categorize.queue.ts
- apps/api/src/worker.ts
- apps/api/src/workers/categorize.worker.ts
- apps/api/src/workers/categorize.worker.test.ts
- apps/api/src/workers/index.ts
- pnpm-lock.yaml

## Change Log

- 2026-06-16: Story created (ready-for-dev). First worker/queue/LLM story: introduces BullMQ+Redis, the single LLM gateway (anonymize + Zod-validate egress), the categorize worker with graceful `other` fallback, and the ingestion→enqueue hook. Flags 3 decisions (model, worker topology, batch size). Not implemented — per user instruction.
- 2026-06-16: Implementation started. Selected the story recommendations: default model `claude-haiku-4-5`, worker entrypoint `src/worker.ts`, batch size 25.
- 2026-06-16: Implementation completed and moved to review.
- 2026-06-16: Code review completed; all accepted findings fixed; final verification passed; story marked done.
