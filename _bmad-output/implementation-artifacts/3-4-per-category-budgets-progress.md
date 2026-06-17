---
risk_tier: 3
baseline_commit: 649d4f5
context:
  - _bmad-output/planning-artifacts/epics/epic-3-spending-dashboard.md#Story 3.4
  - _bmad-output/planning-artifacts/epics/requirements-inventory.md#Functional Requirements
  - _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md
  - _bmad-output/implementation-artifacts/3-3-top-merchants-income-vs-expenses-month-over-month.md
  - apps/api/src/modules/transactions/transactions.service.ts
  - apps/api/src/modules/categorization/category-override.service.ts
  - packages/shared/prisma/schema.prisma
  - CLAUDE.md
---

# Story 3.4: Per-category budgets & progress (API)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to set a monthly limit per category and see my progress against it,
so that I can control my spending.

**Scope note:** Backend API only — set-budget (write) + budgets-with-progress (read). The budget UI/progress bars and the web data foundation are deferred to the same later Epic 3 UI story as 3.1–3.3. [Decision: 2026-06-17.]

## Acceptance Criteria

1. An authenticated `PUT /budgets` upserts a budget from `{ category, month, monthlyLimitCents }`, keyed on the existing unique `(userId, category, month)`. A first call creates the row; a repeat call for the same key **updates** `monthlyLimitCents` (no duplicate row). Returns the budget `{ id, category, month, monthlyLimitCents }`.
2. **Validation:** `category` must be a member of the shared `Category` enum; `month` matches `^\d{4}-(0[1-9]|1[0-2])$`; `monthlyLimitCents` is a positive integer (integer cents, `> 0`, JSON-safe). Any violation → `400` via the central error envelope `{ error: { code, message, details? } }`. Unauthenticated → `401`.
3. **RLS write (guardrail):** the upsert runs through `withUserContext(userId)`; the denormalized `userId` is taken from `req.userId` (never the body), and the RLS `WITH CHECK` on `budgets` enforces a user can only write their own rows. No `where: { userId }` as the tenancy mechanism.
4. An authenticated `GET /budgets?month=YYYY-MM` returns the caller's budgets for that month, each as `{ category, month, monthlyLimitCents, spentCents, remainingCents, percentUsed, currency }`.
5. **Progress (read-time):** `spentCents` is the category's CAD outflow spend for that month — reuse the Story 3.1 category-spend aggregation (categorized debits, `amountCents < 0`, `status != removed`). `remainingCents = monthlyLimitCents - spentCents` (signed; negative = over budget). `percentUsed` is an integer percentage computed in integer math (`limit = 0` guarded — return `0`); it may exceed `100`. `currency` is `"CAD"` (see v1 currency note).
6. **Recomputes automatically (core AC):** progress is computed on read from live transaction data, not stored — so newly-arrived/categorized transactions are reflected on the next `GET` with no recompute step.
7. **Money & currency guardrails:** all amounts are integer cents (`monthlyLimitCents`/`spentCents` positive, `remainingCents` signed); no float/dollar math; never sum spend across currencies (progress uses CAD spend only — budgets are CAD in v1 since the `Budget` model has no currency column).
8. **RLS read (guardrail):** `GET /budgets` runs through `withUserContext`; another user's budgets never appear. A category with no budget set is simply absent from the response (only set budgets are returned).
9. Tests cover: upsert create then update-same-key (no duplicate, limit changes), invalid `monthlyLimitCents`/`category`/`month` → `400`, unauthenticated → `401`, `GET` progress math (under, exactly at, and over budget → negative `remainingCents`), `spentCents` reflecting only that month's CAD categorized outflows (excludes inflows/`removed`/other currencies/other months), `percentUsed` integer + `limit=0` guard, and tenant isolation on both endpoints. Supertest with auth cookies + `hasDb` skip; no real Redis/LLM.

## Tasks / Subtasks

- [x] Task 1: Budgets module + routes (AC: #1, #4)
  - [x] Create `apps/api/src/modules/budgets/` with `budgets.routes.ts`, `budgets.controller.ts`, `budgets.service.ts` (route → controller → service → Prisma).
  - [x] `budgetsRouter`: `PUT /` and `GET /`, both behind `requireAuth`. Mount in `apps/api/src/app.ts` at `/budgets` (new resource — one import + one `app.use`, keeping the error middleware last).

- [x] Task 2: Set-budget upsert (AC: #1, #2, #3)
  - [x] Controller `putBudget`: guard `req.userId` (`unauthorized`); Zod-parse `{ category: z.nativeEnum(Category), month: MonthParam, monthlyLimitCents: positive int }`. Reuse the shared `MonthParam` regex (export it from the transactions controller or lift it to a shared spot). On failure → `badRequest`.
  - [x] Service `upsertBudget({ userId, category, month, monthlyLimitCents })`: inside `withUserContext(userId)`, `tx.budget.upsert({ where: { userId_category_month: { userId, category, month } }, create: { userId, category, month, monthlyLimitCents }, update: { monthlyLimitCents } })`. `userId` comes from the authenticated session, never the body. Store `monthlyLimitCents` as `BigInt`.
  - [x] Return `{ id, category, month, monthlyLimitCents }` (cents as JSON-safe integer).

- [x] Task 3: Budgets-with-progress read (AC: #4, #5, #6, #8)
  - [x] Service `budgetsWithProgress({ userId, month })`: inside one `withUserContext(userId)`, (a) fetch the user's budgets for `month`, and (b) get that month's per-currency category spend via the **shared** `aggregateCategorySpendByCurrency` helper. Run sequentially (no `Promise.all` in the tx callback — Story 3.2 lesson).
  - [x] For each budget, `spentCents` = the CAD category total for that month (0 if none); compute `remainingCents` and `percentUsed`. Money stays `bigint` until the response boundary.

- [x] Task 4: Reuse the shared aggregation (AC: #5)
  - [x] Export `aggregateCategorySpendByCurrency` from `transactions.service.ts` (currently private) and import it in the budgets service — do not duplicate the category-spend grouping. This is a behavior-preserving change; re-run the 3.1/3.3 transactions tests to confirm no regression.

- [x] Task 5: Money serialization (AC: #5, #7)
  - [x] Reuse `toSafeIntegerCents` for positive magnitudes (`monthlyLimitCents`, `spentCents`). `remainingCents = monthlyLimitCents - spentCents` derived from already-safe integers (signed; do NOT abs-value via `toSafeIntegerCents`). `percentUsed = limit === 0 ? 0 : Math.round((spent * 100) / limit)` in integer space. No float/dollar math.

- [x] Task 6: Tests & verification (AC: #1–#9)
  - [x] Add `apps/api/src/modules/budgets/budgets.routes.test.ts` (Supertest), reusing the register/login cookie harness and `hasDb` skip.
  - [x] Cover upsert create+update (assert single row, updated limit), validation 400s, 401, progress math (under/at/over), spent isolation (month/currency/inflow/removed), `limit=0`, and tenant isolation.
  - [x] Add a service test if the progress math benefits from one. Confirm the existing transactions tests still pass after exporting the shared helper.
  - [x] Run `pnpm --filter @clarifi/api typecheck` and the budgets + transactions tests. If DB tests hit the 5s timeout, rerun with `--testTimeout=40000 --hookTimeout=40000`.

## Dev Notes

### Risk Tier

Tier 3. This is the first Epic-3 story that **writes** user-owned rows (the budget upsert) under RLS, and it stores money (`monthlyLimitCents`). Run the `CLAUDE.md` guardrail tripwire before marking done (`git diff --name-only`); expected surfaces are `withUserContext`/RLS **writes** and money/`_cents`. 

**No Prisma schema change or migration is needed — and you must not add one.** The `Budget` model already exists in `packages/shared/prisma/schema.prisma` (unique `(userId, category, month)`, `monthlyLimitCents BigInt`, `month Char(7)`), and its RLS is already enabled with a `budgets_isolation` policy in `prisma/migrations/0002_enable_rls`; `clarifi_app` already has table grants (incl. default privileges for future tables). If you find yourself editing the schema or writing a migration, stop — the table is ready.

### Source Story Context

Epic 3: users see where their money goes. Story 3.4 lets a user set a monthly per-category limit and track progress. [Source: _bmad-output/planning-artifacts/epics/epic-3-spending-dashboard.md#Story 3.4]

Epic BDD: *Given a category, when I set a monthly limit (integer cents), then a Budget row is created for that category/month and progress is shown as spent/limit, and progress recomputes as new transactions arrive.* The "shown" half is the deferred UI story; this story is the set + progress API. "Recomputes as new transactions arrive" is satisfied by computing progress on read, not storing it (AC #6). [Source: _bmad-output/planning-artifacts/epics/epic-3-spending-dashboard.md#Story 3.4]

Relevant requirements: budgets in integer cents; per-currency aggregation / never SUM across currencies; NFR8 RLS tenancy. [Source: CLAUDE.md#Money & data model; _bmad-output/planning-artifacts/epics/requirements-inventory.md]

### Architecture Guardrails

- **RLS, DB-enforced, on writes too:** all budget reads/writes go through `withUserContext(userId)`. The `budgets_isolation` policy's `WITH CHECK` rejects an INSERT/UPDATE whose `user_id` ≠ the session GUC, so the denormalized `userId` must be the authenticated user (from `req.userId`), never client input. [Source: prisma/migrations/0002_enable_rls; CLAUDE.md#Multi-tenancy & query safety]
- **Money is integer cents (bigint), never float.** `monthlyLimitCents`/`spentCents` positive; `remainingCents` signed. [Source: CLAUDE.md#Money & data model]
- **Never SUM across currencies.** Progress uses CAD category spend only; do not sum CAD+USD into one `spentCents`. [Source: CLAUDE.md#Money & data model]
- **API patterns:** REST, Zod at the boundary, success returns data directly, central error envelope, JSON camelCase, integer cents + currency. [Source: _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md]
- **Module ownership:** budgets live in their own `modules/budgets`. [Source: _bmad-output/planning-artifacts/architecture/project-structure-boundaries.md]

### V1 Currency Note (defensible limitation)

The `Budget` model has no `currency` column, so a budget is a single limit per `(category, month)`. To honour "never SUM across currencies," progress compares the limit against **CAD** category spend for the month and the response labels `currency: "CAD"`. USD (or other) spend in the same category is intentionally not folded into the same progress number. A future story can add a `currency` column for multi-currency budgets (a schema change). See open questions.

### Previous Story Intelligence (reusable)

- `apps/api/src/modules/transactions/transactions.service.ts` has `aggregateCategorySpendByCurrency(tx, range)` (private) returning per-currency category sums as `bigint` — **export and reuse** it for progress; also `monthRangeUtc`, `toSafeIntegerCents` (abs-valued; magnitudes only), `compareCurrencyBuckets`. [Source: apps/api/src/modules/transactions/transactions.service.ts]
- **Write-under-RLS precedent:** `apps/api/src/modules/categorization/category-override.service.ts` is the closest existing write example — it does a `withUserContext` update of a user-owned row and shows the controller/error shape. Mirror its structure for the budget upsert. [Source: apps/api/src/modules/categorization/category-override.service.ts]
- **Controller validation shape:** `transactions.controller.ts` (`MonthParam`, `safeParse` → `badRequest("INVALID_MONTH", ...)`, `unauthorized`, `next(err)`). The override controller shows `z.nativeEnum(Category)` for category bodies. [Source: apps/api/src/modules/transactions/transactions.controller.ts; apps/api/src/modules/categorization/category-override.controller.ts]
- **Sequential queries inside `withUserContext`** — no `Promise.all` in the interactive-tx callback (Story 3.2 review fix). [Source: _bmad-output/implementation-artifacts/3-2-spending-trend-over-time.md]
- Tests: register/login cookie harness, seed via `prisma`, `hasDb` skip, clean users in `afterAll`. [Source: apps/api/src/modules/transactions/transactions.routes.test.ts]

### Existing Files To Update / Add

- Add: `apps/api/src/modules/budgets/budgets.routes.ts`, `budgets.controller.ts`, `budgets.service.ts`, `budgets.routes.test.ts`.
- Update: `apps/api/src/app.ts` (mount `/budgets`); `apps/api/src/modules/transactions/transactions.service.ts` (export `aggregateCategorySpendByCurrency`). Consider lifting `MonthParam` to a shared spot if importing from the transactions controller is awkward.
- **No** schema/migration change.

### Implementation Guidance

- `PUT /budgets` body: `{ "category": "food_and_dining", "month": "2026-06", "monthlyLimitCents": 60000 }` → `{ id, category, month, monthlyLimitCents }`.
- `GET /budgets?month=2026-06` → `{ month, currency: "CAD", budgets: [ { category, monthlyLimitCents, spentCents, remainingCents, percentUsed } ] }` (or budgets carrying their own `month`; keep shape consistent and documented).
- Upsert compound-key arg name follows Prisma: `where: { userId_category_month: { userId, category, month } }`.
- Validate `monthlyLimitCents` as `z.number().int().positive()` and within `Number.MAX_SAFE_INTEGER`; convert to `BigInt` for storage.

### Testing Standards

- Supertest against `createApp()`; authenticate via `/auth/register` + `/auth/login`; forward the cookie.
- Seed transactions for the budgeted category (CAD outflows in-month, plus an out-of-month, an inflow, a `removed`, and a USD row to prove exclusion) and assert `spentCents`/`remainingCents`/`percentUsed`. Seed a second user to prove isolation.
- DB-backed tests use the `hasDb` skip; no real Redis/LLM. Rerun with `--testTimeout=40000 --hookTimeout=40000` if the 5s DB timeout trips.

### Project Structure Notes

New `apps/api/src/modules/budgets/` + a one-line mount in `app.ts` + exporting one helper from the transactions service. No schema migration, no frontend. Avoid: float/dollar math, cross-currency summation, taking `userId` from the request body, and adding a Budget migration (the table already exists).

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-3-spending-dashboard.md#Story 3.4]
- [Source: _bmad-output/planning-artifacts/epics/requirements-inventory.md#Functional Requirements]
- [Source: _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md]
- [Source: _bmad-output/implementation-artifacts/3-3-top-merchants-income-vs-expenses-month-over-month.md]
- [Source: apps/api/src/modules/transactions/transactions.service.ts]
- [Source: apps/api/src/modules/categorization/category-override.service.ts]
- [Source: packages/shared/prisma/schema.prisma#Budget]
- [Source: packages/shared/prisma/migrations/0002_enable_rls]
- [Source: CLAUDE.md#Money & data model]
- [Source: CLAUDE.md#Multi-tenancy & query safety]

## Pre-Review Due Diligence

**Complete this self-review before marking the story for review.** This repo's code review runs three lenses — Blind Hunter (context-free bugs), Edge Case Hunter (boundaries), Acceptance Auditor (AC coverage). Pre-empt them here so review finds little:

- **AC → test traceability (Acceptance Auditor):** every AC #1–#9 maps to a named test; record the mapping in Completion Notes. Upsert-updates-not-duplicates (#1) and over-budget negative `remainingCents` (#5) each need an explicit test.
- **Guardrail tripwire (mandatory, Tier 3):** run `git diff --name-only`. Expected surfaces are **`withUserContext`/RLS writes** and **money/`_cents`**. Confirm in the record: (a) the budget upsert runs inside `withUserContext` and sets `userId` from `req.userId`, not the body (RLS `WITH CHECK` relies on it); (b) no float/dollar math — `monthlyLimitCents`/`spentCents` positive integers, `remainingCents` signed (not abs-valued), `percentUsed` integer with a `limit=0` guard; (c) no spend summed across currencies (CAD only); (d) **no Prisma schema/migration change** (the Budget table + RLS already exist). If the diff touches `prisma/schema.prisma`, `prisma/migrations`, ingestion sign normalization, idempotency keys, or the LLM gateway, stop — out of scope.
- **Edge / failure paths (Edge Case Hunter):** upsert same key twice (update, no duplicate), `monthlyLimitCents` of 0 / negative / non-integer / huge (>safe-int) → 400, over-budget (negative remaining), exactly at budget (0 remaining, 100%), no spend (0 spent, 0%), `limit=0` percent guard, budget with spend only in USD or another month (CAD/in-month spent = 0), category with no budget (absent from GET), tenant isolation on both PUT and GET, malformed/missing `month` → 400, unauthenticated → 401.
- **Reuse first (Blind Hunter / simplify):** reuse `withUserContext`, the exported `aggregateCategorySpendByCurrency`, `toSafeIntegerCents`, `MonthParam`, `requireAuth`, the override-service write pattern, and the transactions test harness. Do not duplicate the category-spend grouping or hand-roll a second auth/validation pattern.
- **Scope discipline:** touch only the files in *Existing Files To Update / Add*. No frontend, no schema/migration change. Flag any out-of-scope edit with a one-line rationale.
- **Evidence, not claims:** run the commands in *Testing Standards* and paste actual results (typecheck clean + budgets-test pass count + confirmation the transactions tests still pass after exporting the helper) into Completion Notes. Do not mark done on "looks complete."

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Red-first targeted run: `set -a; source .env; set +a; pnpm --filter @clarifi/api exec vitest run src/modules/budgets/budgets.service.test.ts src/modules/budgets/budgets.routes.test.ts --testTimeout=40000 --hookTimeout=40000` failed as expected before implementation: missing `budgets.service.js` and `/budgets` returned 404.
- Green budgets run: same budgets-only command passed after implementation: 2 files, 8 tests.
- Required typecheck gate passed on 2026-06-17: `pnpm --filter @clarifi/api typecheck` (`tsc --noEmit`). Existing Node engine warning remains: wanted `>=20.19`, current shell `v20.16.0`.
- Required focused regression gate passed on 2026-06-17: `set -a; source .env; set +a; pnpm --filter @clarifi/api exec vitest run src/modules/budgets/budgets.service.test.ts src/modules/budgets/budgets.routes.test.ts src/modules/transactions/transactions.service.test.ts src/modules/transactions/transactions.routes.test.ts --testTimeout=40000 --hookTimeout=40000` — 4 files, 25 tests passed.

### Completion Notes List

- Implemented `PUT /budgets` and `GET /budgets` in a new budgets module mounted at `/budgets`, both protected by `requireAuth`.
- Upsert runs inside `withUserContext(req.userId)` and writes `userId` from the authenticated session into both the compound key and create data; the request body `userId` is ignored. This preserves the RLS `WITH CHECK` requirement.
- Added read-time budget progress inside one `withUserContext` with sequential queries: budget read first, then the shared category-spend aggregation. No `where.userId` tenancy filter is used.
- Exported and reused `aggregateCategorySpendByCurrency` from the transactions service. Existing 3.1/3.3 transaction tests pass after the helper export.
- Lifted `MonthParam` to `apps/api/src/lib/month-param.ts` so budgets and transactions reuse the same month validation without controller-to-controller coupling.
- Money stays in integer cents: `monthlyLimitCents` and `spentCents` are positive magnitudes, `remainingCents` is signed by subtraction, and `percentUsed` is integer BigInt arithmetic with a zero-limit guard. No float/dollar math.
- Budget progress uses CAD spend only and labels `currency: "CAD"`; USD spend in the same category is excluded rather than folded into CAD.
- Code review found two patch-level quality gaps: month schema coupling and missing explicit tests for live recompute/unbudgeted-category absence. Both were fixed before the final verification run.
- AC traceability: route tests cover create/update no duplicate, malicious body `userId` ignored, validation 400s, 401s, under/exact/over budget progress, negative `remainingCents`, month/currency/inflow/removed/tenant exclusions, live recompute, and unbudgeted category absence. Service tests cover RLS query shape, `where.userId` absence, CAD-only spend, zero-limit guard, and authenticated-user upsert data.
- Guardrail tripwire: `git status --short` shows only story/sprint files, `app.ts`, `apps/api/src/lib/month-param.ts`, `apps/api/src/modules/budgets/*`, and transaction controller/service helper exports. No Prisma schema, migration, ingestion, idempotency, LLM, or frontend files were touched.

### File List

- `_bmad-output/implementation-artifacts/3-4-per-category-budgets-progress.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/api/src/app.ts`
- `apps/api/src/lib/month-param.ts`
- `apps/api/src/modules/budgets/budgets.controller.ts`
- `apps/api/src/modules/budgets/budgets.routes.ts`
- `apps/api/src/modules/budgets/budgets.service.ts`
- `apps/api/src/modules/budgets/budgets.routes.test.ts`
- `apps/api/src/modules/budgets/budgets.service.test.ts`
- `apps/api/src/modules/transactions/transactions.controller.ts`
- `apps/api/src/modules/transactions/transactions.service.ts`

## Change Log

- 2026-06-17: Story created (ready-for-dev). Scope is the backend per-category monthly budget API — upsert a limit (RLS write, integer cents) and read budgets with read-time progress (spent vs limit) reusing the shared category-spend aggregation. Budget table + RLS already exist (no migration). UI deferred. Not implemented.
- 2026-06-17: Implemented, reviewed, fixed review findings, and verified Story 3.4. Added budgets API, shared month validation, shared category aggregation reuse, DB-backed route tests, service tests, and final typecheck + focused budgets/transactions evidence.
