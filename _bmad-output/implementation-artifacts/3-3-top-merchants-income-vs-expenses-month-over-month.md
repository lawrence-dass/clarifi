---
risk_tier: 3
baseline_commit: c2e3c1303c4d5af125c1d0a725d54d5187ee3943
context:
  - _bmad-output/planning-artifacts/epics/epic-3-spending-dashboard.md#Story 3.3
  - _bmad-output/planning-artifacts/epics/requirements-inventory.md#Functional Requirements
  - _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md
  - _bmad-output/implementation-artifacts/3-1-monthly-category-breakdown.md
  - _bmad-output/implementation-artifacts/3-2-spending-trend-over-time.md
  - apps/api/src/modules/transactions/transactions.service.ts
  - packages/shared/src/money.ts
  - CLAUDE.md
---

# Story 3.3: Top merchants, income vs expenses, month-over-month (aggregation API)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want a per-currency cash-flow summary for a month — income vs expenses, my top merchants, and how each category changed versus last month,
so that I understand my cash flow.

**Scope note:** Backend aggregation API only — the data behind the summary card(s). Chart/table rendering and the web data/charting foundation are deferred to the same later Epic 3 UI story as 3.1/3.2. [Decision: 2026-06-16.]

## Acceptance Criteria

1. An authenticated `GET /transactions/summary?month=YYYY-MM` returns a per-currency cash-flow summary for that month with three sections per currency: income-vs-expenses totals, top merchants by spend, and per-category month-over-month deltas (current month vs the previous calendar month). The response echoes both `month` and `previousMonth`.
2. **Income vs expenses by sign (core AC):** within each currency, `incomeCents` = sum of inflows (`direction = credit` / `amountCents > 0`) and `expensesCents` = sum of outflow magnitudes (`direction = debit` / `amountCents < 0`), both as **positive** integer cents; `netCents = incomeCents - expensesCents` (signed; positive = net inflow). Inflows and outflows are never conflated. `status = removed` rows are excluded.
3. **Top merchants:** the top `N` (default 5) merchants by outflow spend for the month within each currency — grouped by **non-null** `merchantName`, sorted by `totalCents` desc, each row carrying `merchantName`, `totalCents` (positive integer cents), and `transactionCount`. Rows with a null `merchantName` are excluded (no merchant to attribute).
4. **Category month-over-month deltas:** within each currency, for every category appearing in the current **or** previous month, a row `{ category, currentCents, previousCents, deltaCents }` where each amount is positive integer-cent category spend (categorized outflows, the Story 3.1 definition) and `deltaCents = currentCents - previousCents` (signed). A category present in only one of the two months shows `0` on the missing side (never omitted).
5. **Per-currency only (guardrail):** every total is summed within a single currency and never across currencies; CAD and USD are separate buckets. Money is integer cents throughout — `incomeCents`/`expensesCents`/`*Cents` magnitudes are positive; only `netCents` and `deltaCents` are signed.
6. **RLS (guardrail):** all aggregation runs through `withUserContext(userId)` with no `where: { userId }` tenancy guard; a second user's same-month rows never appear in any section.
7. **Validation:** `month` is Zod-validated against `^\d{4}-(0[1-9]|1[0-2])$`; missing/malformed → `400 INVALID_MONTH` via the central error envelope. Unauthenticated → `401`.
8. A month with no data returns `200` with `previousMonth` computed and an empty `currencies` array. **Performance:** index-backed grouped aggregation under RLS (existing `@@index([userId, date])` / `@@index([accountId, merchantName])`), no N+1 over individual transactions; responds `< 500ms` for a typical dataset.
9. Tests cover: income/expense **sign separation** (an inflow and an outflow in the same currency land in the right totals; `netCents` sign correct), top-merchants sort + `N` limit + null-merchant exclusion, category deltas including a category present only in the previous month (negative delta) and only in the current month (delta = current), per-currency isolation, tenant isolation, `400` on bad month, `401` unauthenticated, and empty month. Supertest with auth cookies + `hasDb` skip; no real Redis/LLM.

## Tasks / Subtasks

- [x] Task 1: Route (AC: #1, #7)
  - [x] Add `GET /summary` (behind `requireAuth`) to the existing `transactionsAnalyticsRouter` in `transactions.routes.ts`. No `app.ts` change (already mounted).

- [x] Task 2: Controller + validation (AC: #1, #7)
  - [x] Add `getCashFlowSummary` to `transactions.controller.ts`. Reuse the shared `MonthParam` Zod schema and the `safeParse` → `badRequest("INVALID_MONTH", ...)` + `unauthorized` + `next(err)` shape from `getCategoryBreakdown`. `month` is **required** (mirror category-breakdown, not the optional `endMonth` of the trend).

- [x] Task 3: Aggregation service (AC: #1–#6, #8)
  - [x] In `transactions.service.ts`, export `cashFlowSummary(input: { userId: string; month: string }): Promise<CashFlowSummaryResult>`.
  - [x] Derive `previousMonth` (one calendar month before `month`) and both UTC ranges via the existing `monthRangeUtc` (reuse the `enumerateMonths`-style rollover logic; do not hand-roll month math).
  - [x] Run all aggregation inside a **single** `withUserContext(userId, async (tx) => { ... })`, issuing the queries **sequentially** (Story 3.2 learned the interactive-tx client rejects concurrent queries — no `Promise.all` inside the callback):
    - income/expenses: `groupBy({ by: ["currency", "direction"], where: { date in month, status != removed }, _sum: { amountCents } })` → split credit/debit per currency.
    - top merchants: `groupBy({ by: ["currency", "merchantName"], where: { date in month, direction: debit, amountCents: { lt: 0 }, status != removed, merchantName: { not: null } }, _sum, _count })` → per currency sort desc, take `N`.
    - category spend (current + previous month): reuse a shared category-aggregation helper (see Task 5 reuse note) for each range.
  - [x] Shape into per-currency buckets sorted via `compareCurrencyBuckets`; the union of currencies across all sections must appear (a currency with only income, or only a category delta, still shows up with the other sections empty/zero).

- [x] Task 4: Money serialization & signed math (AC: #2, #4, #5)
  - [x] Keep all sums `bigint`; convert magnitudes (`incomeCents`, `expensesCents`, merchant `totalCents`, category `currentCents`/`previousCents`) to positive integer cents with the existing `toSafeIntegerCents`.
  - [x] **Signed values must not use `toSafeIntegerCents`** (it abs-values via `positiveCents`). Compute `netCents = incomeCents - expensesCents` and `deltaCents = currentCents - previousCents` in number space **after** both operands are safe integers — the difference of two JSON-safe integers is itself safe and sign-correct. Do not introduce float/dollar math.

- [x] Task 5: Reuse — extract shared category aggregation (AC: #4)
  - [x] To avoid duplicating Story 3.1's category-spend grouping, extract an internal helper `aggregateCategorySpendByCurrency(tx, { monthStart, nextMonthStart })` that returns per-currency category sums (`bigint`), and have **both** `categoryBreakdown` (3.1) and `cashFlowSummary` (3.3) call it. This is a behavior-preserving refactor of the already-committed 3.1 service — re-run the 3.1 tests to prove no regression. If the refactor proves risky, fall back to a private duplicate and note why (but prefer the shared helper).

- [x] Task 6: Tests & verification (AC: #1–#9)
  - [x] Extend `transactions.routes.test.ts` (or add `transactions.summary.routes.test.ts`) with the AC #9 cases, reusing the auth-cookie harness and `hasDb` skip.
  - [x] Add a service test asserting sign separation, top-merchant ordering/limit/null exclusion, delta math for categories present in only one month, per-currency isolation, and `withUserContext` usage with no `where: { userId }`.
  - [x] If Task 5's refactor lands, the existing 3.1 `categoryBreakdown` tests must still pass unchanged.
  - [x] Run `pnpm --filter @clarifi/api typecheck` and the transactions tests. If DB tests hit the 5s timeout, rerun with `--testTimeout=40000 --hookTimeout=40000`.

## Dev Notes

### Risk Tier

Tier 3 — sums `_cents` money (now with **signed** net/delta values, a new wrinkle vs 3.1/3.2), must never cross currencies, must keep inflow/outflow separation correct, and reads user rows under RLS. Run the `CLAUDE.md` guardrail tripwire before marking done (`git diff --name-only`); expected surfaces are money/`_cents` aggregation and `withUserContext`/RLS reads. No schema/migration change expected.

### Source Story Context

Epic 3: users see where their money goes. Story 3.3 gives a cash-flow summary — top merchants, income vs expenses, and per-category MoM deltas — so the user understands inflow vs outflow. [Source: _bmad-output/planning-artifacts/epics/epic-3-spending-dashboard.md#Story 3.3]

Epic BDD: *Given categorized, signed transactions, when I view the summary, then top merchants by spend, total income vs expenses, and per-category month-over-month deltas are shown, and inflows (positive) and outflows (negative) are correctly separated.* The "shown" half is the deferred UI story; this story is the summary API. The sign-separation clause is the headline correctness requirement (AC #2). [Source: _bmad-output/planning-artifacts/epics/epic-3-spending-dashboard.md#Story 3.3]

Relevant requirements:
- Signed amounts (user perspective): inflow positive, outflow negative, normalized once at ingestion — this story relies on that sign convention being already correct. [Source: CLAUDE.md#Money & data model]
- Per-currency aggregation; never SUM across currencies. NFR8 RLS; < 500ms dashboard aggregation. [Source: CLAUDE.md#Money & data model; _bmad-output/planning-artifacts/epics/requirements-inventory.md]

### Architecture Guardrails

- **Money is integer cents (bigint), never float.** Magnitudes positive; only net/delta signed. Format to dollars only at the display layer (deferred UI). [Source: CLAUDE.md#Money & data model; packages/shared/src/money.ts]
- **Never SUM across currencies** — group/series on `currency`. [Source: packages/shared/src/money.ts]
- **Signed separation:** income = inflows (credit), expenses = outflow magnitude (debit). Do not net at the row level; sum each side separately, then derive net. [Source: CLAUDE.md#Money & data model]
- **Tenancy via RLS only** — `withUserContext(userId)`, never `where: { userId }`. [Source: CLAUDE.md#Multi-tenancy & query safety]
- **API patterns:** REST, Zod at the boundary, success returns data directly, central error envelope, JSON camelCase, integer cents + currency. [Source: _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md]

### Previous Story Intelligence (3.1 & 3.2 — directly reusable)

`apps/api/src/modules/transactions/` already exists with the patterns this story extends:
- `transactions.service.ts` exports `monthRangeUtc`, `enumerateMonths`, `toSafeIntegerCents` (abs-valued, JSON-safe guard), `compareCurrencyBuckets` (CAD-first then `localeCompare`), and private `positiveCents`. **Reuse them.** Note `toSafeIntegerCents` abs-values — use it only for magnitudes (see Task 4).
- `transactions.controller.ts` has the shared `MonthParam` regex and the `safeParse`/`badRequest`/`unauthorized`/`next(err)` shape. `getCategoryBreakdown` requires `month`; `getSpendingTrend` shows the optional-param variant.
- `transactions.routes.ts` exports `transactionsAnalyticsRouter`, already mounted at `/transactions` — just add `GET /summary`.
- **Sequential queries inside `withUserContext`** — 3.2's review fix established that concurrent `Promise.all` inside the interactive-tx callback is unsafe; loop sequentially. [Source: _bmad-output/implementation-artifacts/3-2-spending-trend-over-time.md]
- 3.1's category-spend grouping (debit + `amountCents<0` + `status != removed` + `category not null`, per `["currency","category"]`) is exactly what the delta section needs — extract and share it (Task 5). [Source: apps/api/src/modules/transactions/transactions.service.ts]
- Tests use the register/login cookie harness, seed via `prisma`, `hasDb` skip, clean users in `afterAll`.

### Existing Files To Update

- `transactions.routes.ts` — add `GET /summary`.
- `transactions.controller.ts` — add `getCashFlowSummary`.
- `transactions.service.ts` — add `cashFlowSummary`; extract the shared `aggregateCategorySpendByCurrency` helper (Task 5) and route `categoryBreakdown` through it.
- `transactions.routes.test.ts` (extend) and/or a new summary test file; `transactions.service.test.ts` (extend).
- No `app.ts` change. No schema change.

### Implementation Guidance

- Suggested response shape (data returned directly):
  ```json
  {
    "month": "2026-06",
    "previousMonth": "2026-05",
    "currencies": [
      {
        "currency": "CAD",
        "incomeCents": 540000,
        "expensesCents": 312300,
        "netCents": 227700,
        "topMerchants": [
          { "merchantName": "Loblaws", "totalCents": 48200, "transactionCount": 9 }
        ],
        "categoryDeltas": [
          { "category": "food_and_dining", "currentCents": 45600, "previousCents": 51000, "deltaCents": -5400 }
        ]
      }
    ]
  }
  ```
- `topMerchants` limit `N` defaults to 5 (see open questions). Sort categoryDeltas deterministically (e.g. by `currentCents` desc, then category name) so output is stable for tests.
- Currency ordering: CAD first, then `localeCompare` (`compareCurrencyBuckets`).

### Testing Standards

- Supertest against `createApp()`; authenticate via `/auth/register` + `/auth/login`, forward the cookie.
- Seed across two months and two currencies: inflows + outflows (assert sign separation), several merchants (assert top-`N` + null-merchant exclusion), a category present only last month and one only this month (assert delta signs), a `removed` row (excluded), and a second user's rows (tenant isolation). Pass an explicit `month`.
- DB-backed tests use the `hasDb` skip; no real Redis/LLM. Rerun with `--testTimeout=40000 --hookTimeout=40000` if the 5s DB timeout trips.

### Project Structure Notes

All work stays inside `apps/api/src/modules/transactions/` (plus tests). No new module, no `app.ts` change, no schema migration. Avoid: frontend work, raw string-interpolated SQL, cross-currency summation, row-level netting, and float/dollar math.

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-3-spending-dashboard.md#Story 3.3]
- [Source: _bmad-output/planning-artifacts/epics/requirements-inventory.md#Functional Requirements]
- [Source: _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md]
- [Source: _bmad-output/implementation-artifacts/3-1-monthly-category-breakdown.md]
- [Source: _bmad-output/implementation-artifacts/3-2-spending-trend-over-time.md]
- [Source: apps/api/src/modules/transactions/transactions.service.ts]
- [Source: apps/api/src/modules/transactions/transactions.controller.ts]
- [Source: CLAUDE.md#Money & data model]
- [Source: CLAUDE.md#Multi-tenancy & query safety]
- [Source: packages/shared/src/money.ts]
- [Source: packages/shared/prisma/schema.prisma#Transaction]

## Pre-Review Due Diligence

**Complete this self-review before marking the story for review.** This repo's code review runs three lenses — Blind Hunter (context-free bugs), Edge Case Hunter (boundaries), Acceptance Auditor (AC coverage). Pre-empt them here so review finds little:

- **AC → test traceability (Acceptance Auditor):** every AC #1–#9 maps to a named test; record the mapping in Completion Notes. The sign-separation (#2) and one-sided category delta (#4) cases each need an explicit test.
- **Guardrail tripwire (mandatory, Tier 3):** run `git diff --name-only`. Expected surfaces are **money/`_cents` aggregation** and **`withUserContext`/RLS reads**. Confirm in the record: (a) no float/dollar math; (b) magnitudes are positive and only `netCents`/`deltaCents` are signed — and that signed values are NOT run through the abs-valuing `toSafeIntegerCents`; (c) no code path sums two currencies together and inflows/outflows are summed separately (no row-level netting); (d) RLS via `withUserContext` with no `where: { userId }`; (e) no Prisma schema/migration change. If the diff touches sign normalization at ingestion, idempotency keys, the LLM gateway, or `prisma/migrations`, stop — out of scope.
- **Edge / failure paths (Edge Case Hunter):** month with only inflows (expenses 0, net positive), only outflows (income 0, net negative), a category only in the previous month (negative delta) and only in the current month (delta = current), ties in top-merchant ordering, fewer than `N` merchants, null-merchant rows excluded, previous-month rollover across a year boundary (e.g. `month=2026-01` → `previousMonth=2025-12`), per-currency isolation, tenant isolation, empty month, `400`/`401`.
- **Reuse first (Blind Hunter / simplify):** reuse `monthRangeUtc`, `toSafeIntegerCents`, `compareCurrencyBuckets`, `MonthParam`, the controller shape, `requireAuth`, `withUserContext`, the 3.1/3.2 test harness, and the extracted `aggregateCategorySpendByCurrency` helper. Do not duplicate the category-spend grouping between 3.1 and 3.3 — share it.
- **Scope discipline:** touch only files in *Existing Files To Update*. No frontend, no schema change, no `app.ts` change. Flag any out-of-scope edit with a one-line rationale.
- **Evidence, not claims:** run the commands in *Testing Standards* and paste actual results (typecheck clean + summary-test pass count, plus confirmation the 3.1 tests still pass after the Task 5 refactor) into Completion Notes. Do not mark done on "looks complete."

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Red-first targeted test run before implementation: `cashFlowSummary` was missing and `/transactions/summary` returned 404, as expected.
- `pnpm --filter @clarifi/api typecheck` passed on 2026-06-17. Note: pnpm emitted the existing Node engine warning (`wanted >=20.19`, current shell `v20.16.0`), but `tsc --noEmit` completed successfully.
- `set -a; source .env; set +a; pnpm --filter @clarifi/api exec vitest run src/modules/transactions/transactions.service.test.ts src/modules/transactions/transactions.routes.test.ts --testTimeout=40000 --hookTimeout=40000` passed on 2026-06-17: 2 test files, 17 tests.

### Completion Notes List

- Implemented authenticated `GET /transactions/summary?month=YYYY-MM` with required month validation, central `INVALID_MONTH` error shape, and 401 handling through the existing auth middleware.
- Added `cashFlowSummary` aggregation inside one `withUserContext(userId)` callback with sequential `groupBy` queries: income/expense totals, top merchants, current category spend, and previous category spend. No query adds `where.userId`.
- Preserved inflow/outflow separation and per-currency isolation. Income uses `direction=credit` plus positive cents; expenses/top merchants/category spend use `direction=debit` plus negative cents and positive output magnitudes.
- Kept all stored sums as bigint and converted only magnitude fields through `toSafeIntegerCents`. Signed `netCents` and `deltaCents` are derived by subtraction after magnitude conversion, so they are not abs-valued.
- Extracted `aggregateCategorySpendByCurrency` and routed both Story 3.1 `categoryBreakdown` and Story 3.3 deltas through it; the focused route run includes the existing 3.1 category-breakdown tests and they passed.
- BMAD code review found one coverage gap: expense-only months did not explicitly prove negative `netCents`. Fixed with a service regression test that also proves `previousMonth` rollover from `2026-01` to `2025-12`.
- Guardrail tripwire `git diff --name-only` only showed the story/sprint files and `apps/api/src/modules/transactions/*` implementation/tests. No schema, migration, ingestion sign-normalization, idempotency, LLM, raw SQL, or frontend files were touched.
- AC traceability: route tests cover summary shape, sign separation, top merchant sort/limit/null exclusion, one-sided current and previous category deltas, per-currency isolation, tenant isolation, empty month, 400, and 401. Service tests cover RLS usage/no `where.userId`, sequential query shapes, signed net/delta math, and January previous-month rollover.

### File List

- `_bmad-output/implementation-artifacts/3-3-top-merchants-income-vs-expenses-month-over-month.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/api/src/modules/transactions/transactions.controller.ts`
- `apps/api/src/modules/transactions/transactions.routes.ts`
- `apps/api/src/modules/transactions/transactions.service.ts`
- `apps/api/src/modules/transactions/transactions.routes.test.ts`
- `apps/api/src/modules/transactions/transactions.service.test.ts`

## Change Log

- 2026-06-17: Story created (ready-for-dev). Scope is the backend per-currency cash-flow summary API — income vs expenses (signed), top merchants by spend, and per-category month-over-month deltas (RLS, integer cents, never-SUM-across-currencies, signed net/delta). Dashboard UI deferred. Extends the 3.1/3.2 transactions module. No schema change. Not implemented.
- 2026-06-17: Implemented and reviewed Story 3.3. Added summary route/controller/service, extracted shared category aggregation for 3.1/3.3, added service and route coverage, fixed review coverage gap for negative `netCents`, and verified typecheck plus focused transactions tests before marking done.
