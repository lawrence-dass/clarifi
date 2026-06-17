---
risk_tier: 3
baseline_commit: 873abf668abd0ee96bdd9f9567b7ab5eebd33672
context:
  - _bmad-output/planning-artifacts/epics/epic-3-spending-dashboard.md#Story 3.1
  - _bmad-output/planning-artifacts/epics/requirements-inventory.md#Functional Requirements
  - _bmad-output/planning-artifacts/architecture/project-structure-boundaries.md#Requirements -> Structure Mapping (by epic)
  - _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md
  - packages/shared/src/money.ts
  - apps/api/src/modules/ingestion/ingestion.routes.ts
  - CLAUDE.md
---

# Story 3.1: Monthly category breakdown (aggregation API)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want a per-currency breakdown of my spending by category for a given month,
so that I can see my biggest spending categories.

**Scope note:** This story delivers the **backend aggregation API only** — the data behind the donut chart and the `< 500ms` performance AC. The dashboard UI (chart rendering, TanStack Query/api-client foundation, chart library) is deferred to a separate Epic 3 UI story, because the web app currently has no data-fetching or charting foundation and bundling that one-time bootstrap with guardrail-sensitive money aggregation would create a large, mixed Tier-3 surface. [Decision: 2026-06-16, confirmed with user.]

## Acceptance Criteria

1. An authenticated `GET /transactions/category-breakdown?month=YYYY-MM` returns a per-currency category breakdown of the caller's spending for that calendar month.
2. **Per-currency only (guardrail):** totals are summed **within a single currency** and never across currencies. The response is a list of currency buckets, each with its own total and category rows. CAD and USD never share a sum. Money is integer cents throughout.
3. **RLS (guardrail):** the aggregation runs through `withUserContext(userId)`; only the caller's transactions are aggregated. A second user's transactions in the same month never appear, even with identical categories/currencies.
4. **Spend definition:** only outflows are counted — transactions with `direction = debit` (`amountCents < 0`) and `status != removed`, with a non-null `category`. Magnitudes are returned as **positive** integer cents. (Inflows/`income` and not-yet-categorized rows are excluded by this filter; see open questions for `transfers` and `pending` handling.)
5. Within each currency bucket, category rows are sorted by `totalCents` descending; each row carries `category`, `totalCents` (positive integer cents), and `transactionCount`. Each currency bucket carries `currency` and a `totalCents` equal to the sum of its own category rows.
6. **Validation:** `month` is parsed with Zod against `^\d{4}-(0[1-9]|1[0-2])$`; a missing or malformed `month` returns `400` via the central error envelope `{ error: { code, message, details? } }`. An unauthenticated request returns `401` via `requireAuth`.
7. Month boundaries are computed as a half-open range `[monthStart, nextMonthStart)`; a month with no matching data returns `200` with an empty `currencies` array (not a 404 or error).
8. **Performance:** the breakdown is produced by a **single** grouped aggregation query (no N+1, no per-category round-trips), backed by the existing `@@index([userId, date])`; it must respond in `< 500ms` for a typical dataset.
9. Tests cover: multi-currency + multi-category success (asserting per-currency isolation and descending sort), empty month → `200` empty list, invalid `month` → `400`, unauthenticated → `401`, tenant isolation (another user's rows excluded), and correct integer-cents JSON serialization. Supertest with auth cookies + the `hasDb` skip pattern; no real Redis/LLM.

## Tasks / Subtasks

- [x] Task 1: Transactions module + route (AC: #1, #6)
  - [x] Create `apps/api/src/modules/transactions/` with `transactions.routes.ts`, `transactions.controller.ts`, `transactions.service.ts` (route → controller → service → Prisma, per the layering rule).
  - [x] Register `GET /category-breakdown` behind `requireAuth` on a new `transactionsAnalyticsRouter`.
  - [x] Mount it in `apps/api/src/app.ts` at `/transactions` alongside the existing ingestion-owned router. Method/path do not collide (`GET /category-breakdown` vs `POST /import`, `PATCH /:transactionId/category`); a non-matching request falls through to the next router. Document this as a deliberate structural variance (see Project Structure Notes).

- [x] Task 2: Aggregation service (AC: #2, #3, #4, #5, #7, #8)
  - [x] In `transactions.service.ts`, export `categoryBreakdown(input: { userId: string; month: string }): Promise<CategoryBreakdownResult>`.
  - [x] Compute the half-open month range `[monthStart, nextMonthStart)` from `month` (see Dev Notes for the timezone decision).
  - [x] Run a **single** `withUserContext(userId, (tx) => tx.transaction.groupBy(...))` grouped by `["currency", "category"]` with `_sum: { amountCents: true }` and `_count: { _all: true }`, filtering `date` in range, `direction: debit` (or `amountCents: { lt: 0 }`), `status: { not: removed }`, and `category: { not: null }`. RLS supplies the user filter — do not add `where: { userId }` as the tenancy guard.
  - [x] Shape grouped rows into per-currency buckets; magnitudes are `-sum` (positive); sort categories desc by `totalCents`; compute each bucket's `totalCents` from its own rows only — never across currencies.

- [x] Task 3: Validation, controller, error contract (AC: #1, #6)
  - [x] Zod-parse the `month` query param; on failure throw `badRequest("INVALID_MONTH", ...)` (reuse `apps/api/src/lib/app-error.ts`). Guard `req.userId` with `unauthorized(...)` mirroring existing controllers.
  - [x] Return the resource data directly (no wrapper), per the success format pattern. Pass all errors to `next(err)`; never leak Prisma internals.

- [x] Task 4: Money serialization (AC: #2, #5)
  - [x] `groupBy._sum.amountCents` is a `bigint`; convert to a JSON-safe **integer number** of cents at the response boundary (values are well within `Number.MAX_SAFE_INTEGER` for realistic monthly sums). Cents stay integers — never divide to dollars here. `currency` always travels with every amount.
  - [x] Do not introduce float math anywhere in the path.

- [x] Task 5: Tests & verification (AC: #1–#9)
  - [x] Add `apps/api/src/modules/transactions/transactions.routes.test.ts` (Supertest). Reuse the auth-cookie harness from `category-override.routes.test.ts` (`register` → `login` → cookie) and the `hasDb` skip pattern.
  - [x] Seed a fixture with two currencies (CAD + USD), multiple categories, inflow + outflow + `removed` rows, plus a second user's rows in the same month; assert per-currency isolation, descending sort, exclusion of inflows/removed/other-user rows, and integer-cents serialization.
  - [x] Cover empty month (`200` empty), invalid `month` (`400`), and unauthenticated (`401`).
  - [x] Run `pnpm --filter @clarifi/api typecheck` and the new route test. If DB tests hit the 5s timeout, rerun with `--testTimeout=40000 --hookTimeout=40000`.

## Dev Notes

### Risk Tier

Tier 3. This story sums `_cents` money, must honour the **never-SUM-across-currencies** guardrail, and reads user-owned rows under RLS — all guardrail surfaces. Before marking done, run the `CLAUDE.md` guardrail tripwire (`git diff --name-only`); the expected surfaces are money/`_cents` aggregation and `withUserContext`/RLS reads. No schema change or migration is expected; if one appears, reassess (it escalates the migration/RLS guardrail).

### Source Story Context

Epic 3 objective: users see where their money goes. Story 3.1 renders a donut of spend by category for a month; this story is the aggregation API behind it. [Source: _bmad-output/planning-artifacts/epics/epic-3-spending-dashboard.md#Story 3.1]

Epic BDD: *Given categorized transactions for a month, when I open the dashboard, then a per-currency category breakdown renders (no cross-currency summing), and the API responds in under 500ms for a typical dataset.* The "renders" half is the deferred UI story; the "per-currency, no cross-currency summing, < 500ms API" half is this story. [Source: _bmad-output/planning-artifacts/epics/epic-3-spending-dashboard.md#Story 3.1]

Relevant requirements:
- Per-currency aggregation; never SUM across currencies; CAD primary, USD broken out. [Source: CLAUDE.md#Money & data model]
- NFR (performance): dashboard aggregation responds < 500ms for a typical dataset. [Source: _bmad-output/planning-artifacts/epics/requirements-inventory.md]
- NFR8: multi-tenancy is DB-enforced through RLS. [Source: _bmad-output/planning-artifacts/epics/requirements-inventory.md]

### Architecture Guardrails

- **Money is integer cents (bigint), never float.** All arithmetic in cents; format to dollars only at the display layer (which is the deferred UI story, not here). Field names end in `_cents`. [Source: CLAUDE.md#Money & data model; packages/shared/src/money.ts]
- **Never SUM across currencies.** Aggregations are per-currency. The shared `sumCents` helper literally throws if asked to mix currencies — this story enforces the same invariant structurally by grouping on `currency`. [Source: packages/shared/src/money.ts]
- **Signed amounts (user perspective):** outflow negative, inflow positive — normalized once at ingestion. Spend = outflows (`amountCents < 0` / `direction = debit`); return positive magnitudes. [Source: CLAUDE.md#Money & data model]
- **Tenancy via RLS only.** All user-data reads run through `withUserContext(userId)`; never rely on `where: { userId }` as the enforcement mechanism. [Source: CLAUDE.md#Multi-tenancy & query safety; apps/api/src/middleware/auth.ts]
- **API patterns:** REST, Zod at the boundary, success returns data directly (no wrapper), errors via the central `{ error: { code, message, details? } }` middleware, JSON camelCase, money as integer cents with an accompanying currency. [Source: _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md]
- **Module ownership:** Epic 3 dashboard aggregations belong in `modules/transactions`. [Source: _bmad-output/planning-artifacts/architecture/project-structure-boundaries.md#Requirements -> Structure Mapping (by epic)]

### Timezone Decision (month boundaries)

The app does not yet store a per-user timezone. For v1, compute `[monthStart, nextMonthStart)` in **UTC** (`Date.UTC(year, monthIndex, 1)` → `Date.UTC(year, monthIndex + 1, 1)`) for deterministic, testable boundaries. Document this as a known v1 simplification; a later story can switch to the user's local calendar month (likely `America/Toronto`) once a user TZ exists. Do not silently use the server's local time — be explicit about UTC. (See open questions.)

### Existing Files To Update

- `apps/api/src/app.ts`: mount the new analytics router at `/transactions` (one added `app.use` line + import). Preserve the existing `/auth` and `/transactions` (ingestion) mounts and the **error middleware last** ordering.
- No other existing files should need changes. The ingestion-owned `transactionsRouter` (import + override) is left as-is.

### Reuse — do not reinvent

- `requireAuth` (`apps/api/src/middleware/auth.ts`) sets `req.userId`; gate the route with it.
- `withUserContext` (`@clarifi/shared`) for the RLS-scoped query.
- `badRequest` / `unauthorized` from `apps/api/src/lib/app-error.ts`; the central `errorMiddleware` already renders the envelope.
- Controller shape: copy the try/catch → `next(err)` pattern from `ingestion.controller.ts`.
- Test harness: the `authenticate()` register/login cookie helper and `seedTransaction` style from `category-override.routes.test.ts`; the `hasDb` skip from the worker/override tests.
- Domain enums (`TransactionDirection`, `TransactionStatus`, `Category`) and money helpers import from `@clarifi/shared` — never duplicate.

### Previous Story Intelligence

- The `/transactions` path is **already mounted** from `apps/api/src/modules/ingestion/ingestion.routes.ts` (`transactionsRouter`: `POST /import`, `PATCH /:transactionId/category`). Mounting a second router for `GET /category-breakdown` is safe (no method/path overlap) and avoids piling read-analytics into the ingestion module. [Source: apps/api/src/app.ts; apps/api/src/modules/ingestion/ingestion.routes.ts]
- Story 2.3 added the override route to that ingestion router; do not move or disturb it in this story. [Source: _bmad-output/implementation-artifacts/2-3-category-override-correction-learning.md]
- DB-backed API tests use the `hasDb` skip (`DATABASE_URL` absent/placeholder → skipped) and clean created users in `afterAll`. [Source: apps/api/src/modules/categorization/category-override.routes.test.ts]

### Implementation Guidance

- Suggested response shape (data returned directly):
  ```json
  {
    "month": "2026-06",
    "currencies": [
      { "currency": "CAD", "totalCents": 123456,
        "categories": [
          { "category": "food_and_dining", "totalCents": 45600, "transactionCount": 12 },
          { "category": "transport", "totalCents": 20100, "transactionCount": 5 }
        ] },
      { "currency": "USD", "totalCents": 8000, "categories": [ ... ] }
    ]
  }
  ```
- Currency bucket ordering: CAD first (primary), then others alphabetically, for stable output.
- Prefer Prisma `groupBy` over raw SQL (stays parameterized and within the RLS-scoped client). One query returns all `(currency, category)` sums + counts; shape in memory.
- Keep the service pure of HTTP concerns; the controller owns Zod parsing and status codes.

### Testing Standards

- Supertest against `createApp()`; authenticate via `/auth/register` + `/auth/login` and forward the cookie.
- Seed via `prisma` directly (as the override/worker tests do); include CAD+USD, an `income`/inflow row, a `removed` row, and a second user's rows — then assert they're all excluded/ isolated correctly.
- DB-backed tests use the `hasDb` skip; no real Redis or LLM is involved in this story.
- Assert money fields are integers (cents), positive, and never mixed across currencies.
- If default API tests hit the known 5s DB timeout, rerun with `pnpm --filter @clarifi/api exec vitest run --testTimeout=40000 --hookTimeout=40000`.

### Project Structure Notes

Expected additions:
- `apps/api/src/modules/transactions/transactions.routes.ts`
- `apps/api/src/modules/transactions/transactions.controller.ts`
- `apps/api/src/modules/transactions/transactions.service.ts`
- `apps/api/src/modules/transactions/transactions.routes.test.ts`

Expected modification:
- `apps/api/src/app.ts` (mount the new router)

Structural variance (documented): `/transactions` is served by two routers — the ingestion module (write: import + override) and the new transactions module (read: aggregation). This is intentional for this story to avoid refactoring ingestion-owned write routes inside a read-only story. A future cleanup can consolidate all `/transactions` routes under `modules/transactions`. Avoid: frontend work, schema migrations, raw SQL, and any cross-currency summation.

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-3-spending-dashboard.md#Story 3.1]
- [Source: _bmad-output/planning-artifacts/epics/requirements-inventory.md#Functional Requirements]
- [Source: _bmad-output/planning-artifacts/architecture/project-structure-boundaries.md#Requirements -> Structure Mapping (by epic)]
- [Source: _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md]
- [Source: CLAUDE.md#Money & data model]
- [Source: CLAUDE.md#Multi-tenancy & query safety]
- [Source: packages/shared/src/money.ts]
- [Source: apps/api/src/app.ts]
- [Source: apps/api/src/middleware/auth.ts]
- [Source: apps/api/src/modules/ingestion/ingestion.controller.ts]
- [Source: apps/api/src/modules/categorization/category-override.routes.test.ts]
- [Source: packages/shared/prisma/schema.prisma#Transaction]

## Pre-Review Due Diligence

**Complete this self-review before marking the story for review.** This repo's code review runs three lenses — Blind Hunter (context-free bugs), Edge Case Hunter (boundaries), Acceptance Auditor (AC coverage). Pre-empt them here so review finds little:

- **AC → test traceability (Acceptance Auditor):** every AC #1–#9 maps to at least one named test; record the mapping in Completion Notes. No AC ships without a test.
- **Guardrail tripwire (mandatory, Tier 3):** run `git diff --name-only`. Expected guardrail surfaces are **money/`_cents` aggregation** and **`withUserContext`/RLS reads**. Confirm in the record that (a) no float/dollar math entered the path — all amounts are integer cents until the display layer; (b) every currency is summed independently and no code path can add two currencies' cents together; (c) the query is RLS-scoped via `withUserContext` with no `where: { userId }` standing in for tenancy; (d) no Prisma schema/migration change appeared. If the diff touches sign normalization, idempotency keys, the LLM gateway, or `prisma/migrations`, stop — that's out of scope.
- **Edge / failure paths (Edge Case Hunter):** enumerate and test — empty month (200 empty), invalid/missing `month` (400), unauthenticated (401), month with only inflows/`removed`/null-category rows (excluded → empty/partial), multi-currency isolation, a second user's identical-looking rows (tenant isolation), and month-boundary correctness (last day of month included, first day of next month excluded).
- **Reuse first (Blind Hunter / simplify):** reuse `requireAuth`, `withUserContext`, `badRequest`/`unauthorized`, the `ingestion.controller.ts` try/catch shape, and the `category-override.routes.test.ts` auth harness. Do not add a second auth/DB pattern or hand-roll currency summing that `groupBy` already does.
- **Scope discipline:** touch only the files in *Project Structure Notes*. No frontend, no schema change, no edits to the ingestion-owned write routes. Flag any out-of-scope edit with a one-line rationale.
- **Evidence, not claims:** run the commands in *Testing Standards* and paste actual results (typecheck clean + route-test pass count) into Completion Notes. Do not mark done on "looks complete."

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-16: Added `modules/transactions` route/controller/service for `GET /transactions/category-breakdown`.
- 2026-06-16: Mounted read-only analytics router beside the existing ingestion-owned `/transactions` router without changing write routes.
- 2026-06-16: Implemented UTC month boundaries, RLS-scoped single `groupBy`, per-currency shaping, descending category sort, and JSON-safe integer-cent response conversion.
- 2026-06-16: Code review fix: tightened spend filter to require both `direction = debit` and `amountCents < 0`.
- 2026-06-16: Code review fix: added service guardrail test proving one `groupBy` call, `withUserContext`, currency/category grouping, UTC half-open boundaries, and no `where.userId` tenancy shortcut.
- 2026-06-16: Code review fix: kept currency bucket accumulation as `bigint` until response-boundary conversion.

### Completion Notes List

- Implemented backend-only monthly category breakdown API returning `{ month, currencies }` directly.
- Response groups by currency first and never sums CAD/USD together; categories are sorted by `totalCents` descending inside each currency bucket.
- Spend filter counts only posted/non-removed, categorized outflows: `direction = debit` and `amountCents < 0`.
- RLS guardrail is enforced through `withUserContext(userId)`; the aggregation query intentionally has no `where: { userId }`.
- Money guardrail: all source sums are `bigint` cents, bucket totals stay `bigint` internally, and response fields are JSON-safe integer cents with currency attached.
- Month boundaries use UTC `[monthStart, nextMonthStart)` as the v1 simplification documented in the story.
- AC traceability:
  - AC1: `GET /transactions/category-breakdown > returns isolated per-currency category spending sorted by category total`.
  - AC2: route success fixture asserts CAD and USD are separate buckets; service test asserts `groupBy` by `["currency", "category"]`.
  - AC3: route success fixture seeds a second user's same-month matching row and asserts exclusion; service test asserts `withUserContext` and no `where.userId`.
  - AC4: route fixture includes credit/inflow, removed, null-category, and next-month rows; service test asserts debit and negative-cent filters.
  - AC5: route success fixture asserts descending category rows, bucket totals, positive integer cents, and transaction counts.
  - AC6: route tests cover invalid/missing `month` as `400 INVALID_MONTH` and unauthenticated as `401`.
  - AC7: route test covers empty month returning `200` with empty `currencies`.
  - AC8: service test proves one grouped aggregation query; implementation uses existing indexed date filter under RLS.
  - AC9: route and service tests cover the specified success/failure paths with no Redis/LLM.
- Verification:
  - `pnpm --filter @clarifi/api typecheck` passed.
  - `set -a; source .env; set +a; pnpm --filter @clarifi/api exec vitest run src/modules/transactions/transactions.service.test.ts src/modules/transactions/transactions.routes.test.ts --testTimeout=40000 --hookTimeout=40000` passed: 2 files, 5 tests.
  - `set -a; source .env; set +a; pnpm --filter @clarifi/api exec vitest run --testTimeout=90000 --hookTimeout=90000` passed: 16 files, 111 tests.
- Guardrail evidence: no schema/migration change; no float/dollar math; no LLM gateway/idempotency/sign-normalization changes; all aggregation sums are per-currency; RLS query uses `withUserContext`.
- All test commands emitted the existing Node engine warning: package wants Node `>=20.19`, current shell is Node `v20.16.0`.

### File List

- `_bmad-output/implementation-artifacts/3-1-monthly-category-breakdown.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/api/src/app.ts`
- `apps/api/src/modules/transactions/transactions.routes.ts`
- `apps/api/src/modules/transactions/transactions.controller.ts`
- `apps/api/src/modules/transactions/transactions.service.ts`
- `apps/api/src/modules/transactions/transactions.routes.test.ts`
- `apps/api/src/modules/transactions/transactions.service.test.ts`

## Change Log

- 2026-06-16: Story created (ready-for-dev). Scope is the backend per-currency category-breakdown aggregation API (RLS, integer cents, never-SUM-across-currencies, < 500ms); dashboard UI deferred to a later Epic 3 story. No schema change. Not implemented.
- 2026-06-16: Implemented, reviewed, fixed review findings, and marked done after targeted and full API verification passed.
