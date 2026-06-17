---
risk_tier: 3
baseline_commit: 873abf668abd0ee96bdd9f9567b7ab5eebd33672
context:
  - _bmad-output/planning-artifacts/epics/epic-3-spending-dashboard.md#Story 3.2
  - _bmad-output/planning-artifacts/epics/requirements-inventory.md#Functional Requirements
  - _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md
  - _bmad-output/implementation-artifacts/3-1-monthly-category-breakdown.md
  - apps/api/src/modules/transactions/transactions.service.ts
  - packages/shared/src/money.ts
  - CLAUDE.md
---

# Story 3.2: Spending trend over time (aggregation API)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want a per-currency monthly spending total for the last 6 months,
so that I can see whether my spending is rising.

**Scope note:** Backend aggregation API only — the data behind the trend line. The chart rendering and the web data/charting foundation are deferred to the same later Epic 3 UI story as 3.1, consistent with the scope decision made for 3.1. [Decision: 2026-06-16.]

## Acceptance Criteria

1. An authenticated `GET /transactions/spending-trend` returns per-currency monthly spend totals for a 6-month window (the anchor month plus the 5 preceding calendar months).
2. **Dense series, no gaps (core AC):** every one of the 6 months appears for each currency in the response — months with no spend report `totalCents: 0`, never an omitted/missing entry. The 6-month axis is returned explicitly and is identical across all currency series.
3. **Per-currency only (guardrail):** monthly totals are summed within a single currency and never across currencies. CAD and USD are separate series. Money is integer cents throughout.
4. **RLS (guardrail):** aggregation runs through `withUserContext(userId)`; only the caller's transactions are counted. A second user's same-month rows never appear.
5. **Spend definition:** only outflows are counted — `direction = debit` (`amountCents < 0`) and `status != removed`. Magnitudes are returned as **positive** integer cents. Note: unlike 3.1 (a by-category breakdown), this total-spend trend does **not** filter on `category`, so uncategorized outflows are still counted as spend. (Inflows/`income` are excluded by the debit filter; see open questions for `transfers`.)
6. **Anchor & window:** an optional `endMonth=YYYY-MM` query param sets the most-recent month (default: the current UTC month). The window is fixed at 6 months. `endMonth` is Zod-validated against `^\d{4}-(0[1-9]|1[0-2])$`; malformed → `400 INVALID_MONTH` via the central error envelope. Unauthenticated → `401`.
7. A user with no spend in the window returns `200` with the 6-month `months` axis populated and an empty `currencies` array. A currency that appears in only one month of the window still returns all 6 months (zero-filled).
8. **Performance:** monthly buckets come from index-backed aggregation under RLS (the existing `@@index([userId, date])`), with no N+1 over individual transactions; responds in `< 500ms` for a typical dataset.
9. Tests cover: multi-currency success with an explicit `endMonth` asserting the dense 6-month axis and zero-fill for a no-spend month; a currency present in only part of the window still zero-filled across all 6 months; per-currency isolation; exclusion of inflows/`removed`; tenant isolation; empty window → `200` empty `currencies`; invalid `endMonth` → `400`; unauthenticated → `401`. Supertest with auth cookies + `hasDb` skip; no real Redis/LLM.

## Tasks / Subtasks

- [x] Task 1: Route (AC: #1, #6)
  - [x] Add `GET /spending-trend` (behind `requireAuth`) to the existing `transactionsAnalyticsRouter` in `apps/api/src/modules/transactions/transactions.routes.ts`. No new router or `app.ts` change needed — the analytics router is already mounted at `/transactions`.

- [x] Task 2: Controller + validation (AC: #6)
  - [x] Add `getSpendingTrend` to `transactions.controller.ts`. Guard `req.userId` with `unauthorized(...)`. Zod-`safeParse` an optional `endMonth` against the shared month regex; on failure throw `badRequest("INVALID_MONTH", ...)`. Reuse the exact pattern from `getCategoryBreakdown`.
  - [x] Default `endMonth` to the current UTC month (`YYYY-MM`) when absent.

- [x] Task 3: Aggregation service (AC: #1, #2, #3, #4, #5, #7, #8)
  - [x] In `transactions.service.ts`, export `spendingTrend(input: { userId: string; endMonth: string }): Promise<SpendingTrendResult>`.
  - [x] Build the dense 6-month axis (oldest → newest) ending at `endMonth`. Reuse/extend the existing `monthRangeUtc` helper (export it rather than duplicate) and add a small month-enumeration helper.
  - [x] **Recommended (lowest-risk) approach:** reuse the proven 3.1 grouping — for the full window, run a single `withUserContext(userId, tx => tx.transaction.groupBy({ by: ["currency"], where: { date in [windowStart, nextMonthStart), direction: debit, amountCents: { lt: 0 }, status: { not: removed } }, _sum }))` **is not sufficient** (it loses the month dimension). Prisma `groupBy` cannot bucket by month, so use one of:
    - **(A, recommended) typed per-month aggregation:** loop the 6 months, run a per-month `groupBy({ by: ["currency"], ... })` reusing `monthRangeUtc`, keep sums as `bigint`. Six index-backed queries for a fixed window — negligible cost, fully typed, bigint-safe, reuses 3.1.
    - **(B, alternative — see open questions) single `$queryRaw` with `date_trunc('month', date)`** grouped by currency + month, run **inside `withUserContext`** (RLS still applies). Parameterize the window bounds (no string interpolation). This is hand-written parameterized SQL — distinct from the LLM NL→SQL path, so the AST-allowlist guardrail does not apply, but you must cast `sum(amount_cents)` to a bigint/text and parse to `BigInt` in TS (Postgres `sum(bigint)` returns `numeric`); never parse to a float.
  - [x] Zero-fill: for every currency observed anywhere in the window, emit all 6 months with `totalCents: 0` where there was no spend. Keep per-currency bucket math in `bigint` until the response boundary.

- [x] Task 4: Money serialization (AC: #2, #3, #5)
  - [x] Convert `bigint` cents to JSON-safe positive integer cents at the response boundary, reusing the `toSafeIntegerCents` guard from `transactions.service.ts` (export/share it rather than duplicate). `currency` always accompanies each amount. No float/dollar math.

- [x] Task 5: Tests & verification (AC: #1–#9)
  - [x] Extend `apps/api/src/modules/transactions/transactions.routes.test.ts` (or add `transactions.trend.routes.test.ts`) with the cases in AC #9, reusing the auth-cookie harness and `hasDb` skip.
  - [x] Add a service-level test asserting the dense axis, zero-fill, per-currency isolation, debit/negative filter, and `withUserContext` usage with no `where: { userId }` tenancy guard. If approach (B) is chosen, also assert RLS scoping and bigint (not float) handling of the raw sum.
  - [x] Run `pnpm --filter @clarifi/api typecheck` and the trend tests. If DB tests hit the 5s timeout, rerun with `--testTimeout=40000 --hookTimeout=40000`.

## Dev Notes

### Risk Tier

Tier 3 — same guardrail surface as 3.1: sums `_cents` money, must never cross currencies, and reads user rows under RLS. Run the `CLAUDE.md` guardrail tripwire before marking done (`git diff --name-only`); expected surfaces are money/`_cents` aggregation and `withUserContext`/RLS reads. No schema/migration change is expected.

### Source Story Context

Epic 3 objective: users see where their money goes. Story 3.2: a 6-month spending trend line so the user sees whether spending is rising. [Source: _bmad-output/planning-artifacts/epics/epic-3-spending-dashboard.md#Story 3.2]

Epic BDD: *Given at least one month of data, when I view the trend, then monthly totals for the last 6 months render per currency, and months with no data show zero, not gaps.* The "render" half is the deferred UI story; the per-currency monthly totals + zero-fill API is this story. The "show zero, not gaps" clause is the headline correctness requirement (AC #2). [Source: _bmad-output/planning-artifacts/epics/epic-3-spending-dashboard.md#Story 3.2]

Relevant requirements:
- Per-currency aggregation; never SUM across currencies. [Source: CLAUDE.md#Money & data model]
- Dashboard aggregation responds < 500ms for a typical dataset; NFR8 RLS tenancy. [Source: _bmad-output/planning-artifacts/epics/requirements-inventory.md]

### Architecture Guardrails

- **Money is integer cents (bigint), never float**; format to dollars only at the display layer (the deferred UI story). [Source: CLAUDE.md#Money & data model; packages/shared/src/money.ts]
- **Never SUM across currencies** — enforce structurally by grouping/series-ing on `currency`. [Source: packages/shared/src/money.ts]
- **Signed amounts**: spend = outflows (`amountCents < 0` / `direction = debit`); return positive magnitudes. [Source: CLAUDE.md#Money & data model]
- **Tenancy via RLS only** — `withUserContext(userId)`; never `where: { userId }` as the guard. If you choose raw SQL (approach B), it must still run inside `withUserContext` so the RLS session var is set; tenancy stays DB-enforced. [Source: CLAUDE.md#Multi-tenancy & query safety]
- **API patterns:** REST, Zod at the boundary, success returns data directly, central error envelope, JSON camelCase, integer cents + currency. [Source: _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md]

### Previous Story Intelligence (3.1 — directly reusable)

Story 3.1 built `apps/api/src/modules/transactions/` with the exact patterns this story extends:
- `transactions.service.ts` already has `monthRangeUtc(month)` (private — export it for reuse), `positiveCents`, `toSafeIntegerCents` (bigint→JSON-safe integer with an `isSafeInteger` guard), and `compareCurrencyBuckets` (CAD-first, then `localeCompare`). **Reuse these; do not duplicate.**
- `transactions.controller.ts` shows the canonical `safeParse` → `badRequest("INVALID_MONTH", ...)` + `unauthorized` + `next(err)` shape. The month regex is `^\d{4}-(0[1-9]|1[0-2])$`.
- `transactions.routes.ts` exports `transactionsAnalyticsRouter`, already mounted at `/transactions` in `app.ts` — just add the new `GET` to it.
- 3.1 chose UTC month boundaries and a single typed `groupBy` (bigint-safe). 3.2 keeps cents as `bigint` until the response boundary the same way.
- Tests use the register/login cookie harness and `hasDb` skip; seed via `prisma` directly; clean users in `afterAll`. [Source: _bmad-output/implementation-artifacts/3-1-monthly-category-breakdown.md; apps/api/src/modules/transactions/]

### Existing Files To Update

- `apps/api/src/modules/transactions/transactions.routes.ts` — add `GET /spending-trend`.
- `apps/api/src/modules/transactions/transactions.controller.ts` — add `getSpendingTrend`.
- `apps/api/src/modules/transactions/transactions.service.ts` — add `spendingTrend`; export the shared helpers (`monthRangeUtc`, `toSafeIntegerCents`) it reuses.
- `apps/api/src/modules/transactions/transactions.routes.test.ts` (extend) and/or a new trend test file.
- No `app.ts` change (router already mounted). No schema change.

### Implementation Guidance

- Suggested response shape (data returned directly):
  ```json
  {
    "months": ["2026-01","2026-02","2026-03","2026-04","2026-05","2026-06"],
    "currencies": [
      { "currency": "CAD", "totals": [
        { "month": "2026-01", "totalCents": 41200 },
        { "month": "2026-02", "totalCents": 0 },
        { "month": "2026-03", "totalCents": 38800 },
        { "month": "2026-04", "totalCents": 50100 },
        { "month": "2026-05", "totalCents": 0 },
        { "month": "2026-06", "totalCents": 46300 }
      ] },
      { "currency": "USD", "totals": [ ...6 entries... ] }
    ]
  }
  ```
- `months` is the canonical axis (oldest → newest); every currency's `totals` has exactly 6 entries aligned to it.
- Currency ordering: CAD first, then `localeCompare` (reuse `compareCurrencyBuckets`).
- Window: `endMonth` inclusive, going back 5 months. Compute `windowStart = monthRangeUtc(firstMonth).monthStart` and `windowEnd = monthRangeUtc(endMonth).nextMonthStart` for a single half-open `[windowStart, windowEnd)` filter if using approach B.

### Testing Standards

- Supertest against `createApp()`; authenticate via `/auth/register` + `/auth/login`, forward the cookie.
- Seed transactions across several months (including a deliberately empty middle month), two currencies, an inflow row, a `removed` row, and a second user's rows; pass an explicit `endMonth` so the window is deterministic.
- Assert: dense 6-month axis, zeros (not gaps) for empty months, per-currency isolation, exclusion of inflows/removed/other-user rows, integer-cents serialization, and `400`/`401` paths.
- DB-backed tests use the `hasDb` skip; no real Redis/LLM. Rerun with `--testTimeout=40000 --hookTimeout=40000` if the 5s DB timeout trips.

### Project Structure Notes

All work stays inside `apps/api/src/modules/transactions/` (plus its tests). No new module, no `app.ts` change, no schema migration. Avoid: frontend work, raw string-interpolated SQL, cross-currency summation, and float/dollar math.

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-3-spending-dashboard.md#Story 3.2]
- [Source: _bmad-output/planning-artifacts/epics/requirements-inventory.md#Functional Requirements]
- [Source: _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md]
- [Source: _bmad-output/implementation-artifacts/3-1-monthly-category-breakdown.md]
- [Source: apps/api/src/modules/transactions/transactions.service.ts]
- [Source: apps/api/src/modules/transactions/transactions.controller.ts]
- [Source: apps/api/src/modules/transactions/transactions.routes.ts]
- [Source: CLAUDE.md#Money & data model]
- [Source: CLAUDE.md#Multi-tenancy & query safety]
- [Source: packages/shared/src/money.ts]
- [Source: packages/shared/prisma/schema.prisma#Transaction]

## Pre-Review Due Diligence

**Complete this self-review before marking the story for review.** This repo's code review runs three lenses — Blind Hunter (context-free bugs), Edge Case Hunter (boundaries), Acceptance Auditor (AC coverage). Pre-empt them here so review finds little:

- **AC → test traceability (Acceptance Auditor):** every AC #1–#9 maps to at least one named test; record the mapping in Completion Notes. The zero-fill/no-gaps AC (#2, #7) must have an explicit test with a deliberately empty middle month.
- **Guardrail tripwire (mandatory, Tier 3):** run `git diff --name-only`. Expected surfaces are **money/`_cents` aggregation** and **`withUserContext`/RLS reads**. Confirm in the record: (a) no float/dollar math — integer cents throughout; (b) no code path sums two currencies together; (c) RLS via `withUserContext` with no `where: { userId }` tenancy guard — and if approach (B)/raw SQL is used, that it runs inside `withUserContext`, is parameterized, and parses `numeric` sums to `bigint` (not float); (d) no Prisma schema/migration change. If the diff touches sign normalization, idempotency keys, the LLM gateway, or `prisma/migrations`, stop — out of scope.
- **Edge / failure paths (Edge Case Hunter):** empty window (200, empty `currencies`, axis still present), a currency present in only one month (still 6 zero-filled entries), an empty middle month (0, not a gap), month/year rollover across the window (e.g. `endMonth=2026-01` → window spans 2025-08…2026-01), inflow/`removed` exclusion, tenant isolation, invalid `endMonth` (400), unauthenticated (401).
- **Reuse first (Blind Hunter / simplify):** reuse `monthRangeUtc`, `toSafeIntegerCents`, `compareCurrencyBuckets`, the controller `safeParse`/`badRequest`/`unauthorized` shape, `requireAuth`, `withUserContext`, and the 3.1 test harness. Do not duplicate the month-range or cents-serialization helpers — export and share them.
- **Scope discipline:** touch only files in *Existing Files To Update*. No frontend, no schema change, no `app.ts` change. Flag any out-of-scope edit with a one-line rationale.
- **Evidence, not claims:** run the commands in *Testing Standards* and paste actual results (typecheck clean + trend-test pass count) into Completion Notes. Do not mark done on "looks complete."

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `pnpm --filter @clarifi/api typecheck` — passed. Node warning: package wants `>=20.19`, current shell is `v20.16.0`.
- `set -a; source .env; set +a; pnpm --filter @clarifi/api exec vitest run src/modules/transactions/transactions.service.test.ts src/modules/transactions/transactions.routes.test.ts --testTimeout=40000 --hookTimeout=40000` — passed: 2 files, 11 tests.
- `set -a; source .env; set +a; pnpm --filter @clarifi/api exec vitest run --testTimeout=90000 --hookTimeout=90000` — passed: 16 files, 117 tests.

### Completion Notes List

- Implemented authenticated `GET /transactions/spending-trend` with optional `endMonth` defaulting to current UTC month.
- Response returns an explicit oldest-to-newest 6-month `months` axis and per-currency dense `totals`; currencies observed in the window are zero-filled for missing months, and empty windows return the axis plus `currencies: []`.
- Spend filtering uses `direction = debit`, `amountCents < 0`, and `status != removed`; uncategorized outflows are included. Returned magnitudes are positive JSON-safe integer cents.
- RLS is enforced through `withUserContext(userId)` with no `where: { userId }` tenancy guard. Implementation uses the typed Prisma per-month `groupBy` approach, not raw SQL.
- Code review fix: changed monthly aggregation from concurrent `Promise.all` calls inside the RLS transaction callback to a bounded sequential six-query loop to avoid transaction-client concurrency ambiguity.
- Code review fix: added explicit route coverage for omitted `endMonth` defaulting to the current UTC month.
- AC traceability: route tests cover authenticated success, dense six-month zero-fill, per-currency isolation, inflow/removed exclusion, tenant isolation, empty window, default `endMonth`, malformed `endMonth`, and unauthenticated. Service test covers year rollover, dense axis, zero-fill, CAD-first/per-currency shaping, debit/negative/removed query filters, no category filter, and no application-level `userId` filter.
- Guardrail tripwire: `git diff --name-only` only shows tracked files and misses the untracked transactions module from Story 3.1/3.2; `git status --short` confirms the analytics module is currently untracked. Reviewed the touched analytics files directly. No float/dollar math, no cross-currency summation, no raw SQL, no schema/migration changes, no sign-normalization/idempotency/LLM surfaces touched by this story.

### File List

- apps/api/src/modules/transactions/transactions.service.ts
- apps/api/src/modules/transactions/transactions.controller.ts
- apps/api/src/modules/transactions/transactions.routes.ts
- apps/api/src/modules/transactions/transactions.service.test.ts
- apps/api/src/modules/transactions/transactions.routes.test.ts
- _bmad-output/implementation-artifacts/3-2-spending-trend-over-time.md
- _bmad-output/implementation-artifacts/sprint-status.yaml

## Change Log

- 2026-06-16: Story created (ready-for-dev). Scope is the backend per-currency 6-month spending-trend aggregation API with zero-filled months (RLS, integer cents, never-SUM-across-currencies); dashboard UI deferred. Extends the 3.1 transactions module. No schema change. Not implemented.
- 2026-06-16: Implemented, reviewed, fixed review findings, verified, and marked done.
