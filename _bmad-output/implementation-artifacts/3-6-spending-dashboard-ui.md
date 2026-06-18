---
risk_tier: 2
baseline_commit: 81fddf4ed9440d7a68ae7bb2c0cb0efadfb012b8
context:
  - _bmad-output/planning-artifacts/epics/epic-3-spending-dashboard.md#Story 3.6
  - _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md
  - _bmad-output/implementation-artifacts/3-5-web-app-foundation.md
  - _bmad-output/implementation-artifacts/3-1-monthly-category-breakdown.md
  - _bmad-output/implementation-artifacts/3-3-top-merchants-income-vs-expenses-month-over-month.md
  - _bmad-output/implementation-artifacts/3-4-per-category-budgets-progress.md
  - apps/web/src/lib/api-client.ts
  - CLAUDE.md
---

# Story 3.6: Spending dashboard UI

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want a dashboard that renders my category breakdown, spending trend, cash-flow summary, and budget progress,
so that I can actually see where my money goes.

**Scope note:** Frontend only. Consumes the already-built Story 3.1–3.4 APIs through the Story 3.5 foundation (apiClient, TanStack Query, charts, shell). No backend/API or schema change.

## Acceptance Criteria

1. The protected `/dashboard` page renders four sections from the existing APIs: (a) category breakdown donut [3.1 `GET /transactions/category-breakdown`], (b) 6-month spending trend line [3.2 `GET /transactions/spending-trend`], (c) cash-flow summary — income/expenses/net + top merchants + category MoM deltas [3.3 `GET /transactions/summary`], and (d) budgets with progress [3.4 `GET /budgets`]. It replaces the current `/dashboard` smoke page.
2. **Data access through the foundation only:** every API call goes through the Story 3.5 `apiClient` wrapped in TanStack Query hooks with array query keys (e.g. `['category-breakdown', { month }]`, `['spending-trend', { endMonth }]`, `['summary', { month }]`, `['budgets', { month }]`). No direct `fetch`, no second data layer.
3. **A single month selector** (`YYYY-MM`, default current month) drives the month-scoped queries (breakdown, summary, budgets) and the trend's `endMonth`. Changing it refetches via the query keys.
4. **Per-currency, never combined (guardrail mirror):** the APIs return per-currency buckets; the UI renders a chosen currency (a currency selector defaulting to CAD, shown only when >1 currency is present) and never sums or merges amounts across currencies. The budgets section is CAD-only (the 3.4 API returns CAD).
5. **Money is display-only:** all amounts come pre-computed from the APIs as integer cents and are rendered via the Story 3.5 display formatter (`formatMoney`/`formatCents`). The UI performs **no** monetary arithmetic — totals, `netCents`, `deltaCents`, `remainingCents`, and `percentUsed` are taken from the API, not recomputed.
6. **States per section:** each section shows the shared `<Loading/>` while pending, `<ErrorState/>` on error (rendering the `ApiError` message, not a crash), and a friendly empty state when the API returns no data for the month (e.g. empty `currencies`/`budgets`). Loading/error come from TanStack Query state, not ad-hoc flags.
7. **Set a budget:** the budgets section includes a form (React Hook Form + Zod) that `PUT /budgets` via an `apiClient` mutation; on success it invalidates the `['budgets', { month }]` query so progress updates without a manual refresh. Validation mirrors the API (`monthlyLimitCents` positive integer; category from the enum).
8. **Quality gates:** `pnpm --filter @clarifi/web typecheck`, `pnpm --filter @clarifi/web test`, and `pnpm --filter @clarifi/web build` pass. Component tests (mocked `apiClient`, real `QueryClient` in a test wrapper) cover at least: a section rendering data, a loading state, an error state, an empty state, and the budget mutation invalidating its query. No real network.
9. **Accessibility & correctness basics:** charts have accessible labels/legends; the donut and trend reflect the API's sort/zero-fill (e.g. trend shows all 6 months incl. zeros, not gaps); category/merchant labels are human-readable. No console errors in build.

## Tasks / Subtasks

- [x] Task 1: Query hooks (AC: #2, #3)
  - [x] Add `apps/web/src/features/dashboard/hooks/` (or `lib/queries/`) with one hook per endpoint, each calling `apiClient<TResponse>(path)` with a typed response and an array query key. Paths are the canonical API resource paths (the apiClient/BFF handles the base/`/api` prefix) — e.g. `apiClient('/transactions/category-breakdown?month=' + month)`.
  - [x] Define response types matching the API shapes (see Dev Notes) — import shared enums (`Category`) from `@clarifi/shared` where useful; do not redefine them.

- [x] Task 2: Dashboard state & layout (AC: #1, #3, #4)
  - [x] A `/dashboard` page (in the protected `(app)` group) with a month selector (default current `YYYY-MM`) and a currency selector (default CAD, hidden when a single currency). Hold month/currency in local state (or a small Zustand store if cleaner) and pass to the sections.
  - [x] Compose the four sections using the shadcn `Card` primitives and the app shell.

- [x] Task 3: Category breakdown donut (AC: #1, #4, #5, #6)
  - [x] Recharts donut of the selected currency's categories (`totalCents`), with legend + accessible labels; loading/error/empty states.

- [x] Task 4: Spending trend line (AC: #1, #5, #6, #9)
  - [x] Recharts line of the selected currency's `totals` across the 6-month `months` axis (render zeros, not gaps); states.

- [x] Task 5: Cash-flow summary (AC: #1, #5, #6)
  - [x] Income / expenses / net cards (net signed; from API), a top-merchants list, and a category MoM delta list (delta signed, with up/down affordance); states.

- [x] Task 6: Budgets + set form (AC: #1, #5, #6, #7)
  - [x] Budget progress rows (limit / spent / remaining / `percentUsed` from API; progress bar via the `percentUsed` value, clamped for display only) + a set-budget form (RHF+Zod) mutating `PUT /budgets` and invalidating `['budgets', { month }]`.

- [x] Task 7: Tests & verification (AC: #8, #9)
  - [x] Component tests with a `QueryClient` test wrapper and a mocked `apiClient`: data render, loading, error, empty, and the budget mutation invalidation.
  - [x] Run `pnpm --filter @clarifi/web typecheck`, `test`, `build`. Optionally drive via the `run`/`verify` skills (sign in → dashboard renders).

### Review Findings
- [x] [Review][Patch] Zero category MoM deltas rendered with an upward/red affordance [`apps/web/src/features/dashboard/cash-flow-summary-section.tsx`] — fixed by centralizing delta icon/tone helpers so negative, positive, and zero deltas render down/green, up/red, and neutral/slate respectively.

## Dev Notes

### Risk Tier

Tier 2. Frontend rendering of money — no backend guardrail (the 3.1–3.4 APIs already enforce RLS, per-currency, integer cents). The guardrail mirror here is **display discipline**: format-only money (no arithmetic), per-currency (never combine), and routing all access through the single `apiClient`. The budget set is a write but goes through `apiClient` → BFF → the 3.4 API, which owns validation + RLS `WITH CHECK`.

### Source Story Context

Epic 3 (added 3.5–3.6 on 2026-06-17): 3.6 is the dashboard UI that finally renders the deferred frontend deliverable (FR13–FR17). It depends on 3.5 (foundation) and the 3.1–3.4 APIs. [Source: _bmad-output/planning-artifacts/epics/epic-3-spending-dashboard.md#Story 3.6]

### API Response Shapes (already built — match these exactly)

- **3.1** `GET /transactions/category-breakdown?month=YYYY-MM` → `{ month, currencies: [{ currency, totalCents, categories: [{ category, totalCents, transactionCount }] }] }` (categories sorted desc).
- **3.2** `GET /transactions/spending-trend?endMonth=YYYY-MM` → `{ months: string[6], currencies: [{ currency, totals: [{ month, totalCents }] }] }` (dense 6-month axis, zeros not gaps).
- **3.3** `GET /transactions/summary?month=YYYY-MM` → `{ month, previousMonth, currencies: [{ currency, incomeCents, expensesCents, netCents, topMerchants: [{ merchantName, totalCents, transactionCount }], categoryDeltas: [{ category, currentCents, previousCents, deltaCents }] }] }`.
- **3.4** `GET /budgets?month=YYYY-MM` → `{ month, currency: "CAD", budgets: [{ category, month, monthlyLimitCents, spentCents, remainingCents, percentUsed, currency }] }`; `PUT /budgets` body `{ category, month, monthlyLimitCents }` → `{ id, category, month, monthlyLimitCents }`.
- All `*Cents` are integer cents; `netCents`/`deltaCents`/`remainingCents` are signed; `percentUsed` is an integer (may exceed 100). [Source: 3-1/3-3/3-4 story files]

### Architecture Guardrails

- **Reuse the 3.5 foundation:** `apiClient` (`apps/web/src/lib/api-client.ts`), `query-client`, `Loading`/`ErrorState`, `formatMoney`/`formatCents` (`@clarifi/shared/money-display`), shadcn primitives, the `(app)` protected group + `AuthGuard`. Do not introduce a second fetch/error/format pattern. [Source: _bmad-output/implementation-artifacts/3-5-web-app-foundation.md]
- **TanStack Query** for all server state; array query keys; loading/error via query state. Mutations invalidate the relevant key. [Source: _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md]
- **Money:** integer cents from the API; format only at display via the shared formatter; never compute money in the component (the API already did). Per-currency; never sum across currencies. [Source: CLAUDE.md#Money & data model]
- **Charts:** Recharts (installed in 3.5). Keep chart components presentational; feed them already-shaped, already-formatted data.

### Implementation Guidance

- One hook per endpoint keeps keys/caching clean; share the `month` (and `endMonth = month`) from page state.
- For the donut/line, map the selected currency bucket only; if the currency isn't present for that month, show the empty state.
- `percentUsed` may exceed 100 (over budget) — clamp the bar width for display but show the real number/text.
- Category enum values are snake_case (`food_and_dining`) — render via a small label map for readability (presentational only).
- Don't block the whole page on one query — each section manages its own loading/error so a single failing endpoint doesn't blank the dashboard.

### Testing Standards

- Vitest + RTL + jsdom (set up in 3.5). Wrap components in a `QueryClientProvider` test helper; mock the `apiClient` module — no real network.
- Cover data/loading/error/empty per a representative section and the budget mutation → invalidation. Assert money is rendered formatted (not raw cents) and per-currency.
- Gates: `pnpm --filter @clarifi/web typecheck`, `test`, `build` must pass.

### Project Structure Notes

Additions under `apps/web/src` (suggested): `features/dashboard/` (page sections + hooks) or `components/dashboard/*` + `lib/queries/*`, and the real `app/(app)/dashboard/page.tsx`. Reuse, don't duplicate, the 3.5 primitives. No backend/API/schema change; no new top-level deps beyond what 3.5 installed (Recharts already present).

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-3-spending-dashboard.md#Story 3.6]
- [Source: _bmad-output/implementation-artifacts/3-5-web-app-foundation.md]
- [Source: _bmad-output/implementation-artifacts/3-1-monthly-category-breakdown.md]
- [Source: _bmad-output/implementation-artifacts/3-2-spending-trend-over-time.md]
- [Source: _bmad-output/implementation-artifacts/3-3-top-merchants-income-vs-expenses-month-over-month.md]
- [Source: _bmad-output/implementation-artifacts/3-4-per-category-budgets-progress.md]
- [Source: apps/web/src/lib/api-client.ts]
- [Source: _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md]
- [Source: CLAUDE.md#Money & data model]

## Pre-Review Due Diligence

**Complete this self-review before marking the story for review.** This repo's code review runs three lenses — Blind Hunter (context-free bugs), Edge Case Hunter (boundaries), Acceptance Auditor (AC coverage). Pre-empt them here so review finds little:

- **AC → test/gate traceability (Acceptance Auditor):** every AC #1–#9 maps to a component test or a named gate (typecheck/test/build). Record the mapping in Completion Notes. The budget mutation→invalidation (#7) and per-section empty/error states (#6) have explicit tests.
- **Guardrail tripwire (Tier 2, display discipline):** run `git diff --name-only`. Confirm: (a) **no monetary arithmetic** in components — all amounts (totals, net, delta, remaining, percent) come from the API and are only formatted; (b) money rendered via the shared display formatter, never raw cents or hand-divided dollars; (c) **no cross-currency** combining — a single selected currency drives breakdown/trend/summary, budgets are CAD; (d) all API calls go through the single `apiClient` + TanStack Query (no stray `fetch`, no ad-hoc loading flags); (e) web-only — no `apps/api`/`packages/shared`/schema changes. If the diff touches the backend or money math, stop — out of scope.
- **Edge / failure paths (Edge Case Hunter):** month with no data (empty `currencies`/`budgets` → empty states, not crashes); a currency absent for the selected month; trend with zero-spend months (render 0, not gaps); over-budget (`percentUsed` > 100, negative `remaining` — clamp bar, show real value); a single failing endpoint doesn't blank the whole page; budget set with invalid input → API 400 surfaced; unauthenticated → AuthGuard redirect (inherited from 3.5).
- **Reuse first (Blind Hunter / simplify):** reuse `apiClient`, `Loading`/`ErrorState`, `formatMoney`, shadcn primitives, RHF+Zod, and the `Category` enum from `@clarifi/shared`. Don't redefine API types loosely or hand-roll a second fetch/format/loading pattern.
- **Scope discipline:** web-only; render existing APIs (no new endpoints). Flag any backend touch with rationale (there should be none).
- **Evidence, not claims:** paste actual `typecheck`/`test`/`build` results into Completion Notes; note any manual run/verify. Do not mark done on "looks complete."

## Dev Agent Record

### Agent Model Used
GPT-5 Codex

### Debug Log References
- 2026-06-17: Replaced the 3.5 `/dashboard` smoke page with the real dashboard UI under the protected `(app)` route group.
- 2026-06-17: Kept endpoint access centralized in `apps/web/src/features/dashboard/hooks.ts`; the only non-test `fetch` usages remain the 3.5 `apiClient` and BFF route handler.
- 2026-06-17: Used a local client-safe category option schema in the dashboard feature because the current `@clarifi/shared` root barrel imports Prisma/server modules into client bundles. Values match the API `Category` enum exactly and are limited to presentation/form validation.
- 2026-06-17: Guardrail scan confirmed no backend/API/schema changes, no client token/cookie access, no hand-dividing cents, and no cross-currency summing.
- 2026-06-17: Code review found one patch-level presentation issue: zero MoM deltas needed neutral affordance rather than up/red. Fixed and reran required gates.

### Completion Notes List
- Implemented the spending dashboard UI with four independent sections: category breakdown donut, six-month spending trend line, cash-flow summary, and CAD budget progress plus set-budget form.
- Added typed TanStack Query hooks with array keys for `category-breakdown`, `spending-trend`, `summary`, and `budgets`; all calls route through the existing `apiClient`.
- Added a single month selector driving all endpoint query keys and a currency selector that appears only when more than one API currency is available. The selected currency is passed to breakdown/trend/summary; budgets remain CAD-only.
- Money display uses `formatMoney` only. API-provided `incomeCents`, `expensesCents`, `netCents`, `totalCents`, `deltaCents`, `spentCents`, `remainingCents`, `monthlyLimitCents`, and `percentUsed` are rendered as supplied; no totals/net/delta/remaining values are recomputed in the UI.
- Each section has its own loading, error, and empty state via `SectionFrame`, `Loading`, and `ErrorState`; a failing endpoint does not blank the whole dashboard.
- Budget mutation validates `monthlyLimitCents` as a positive integer, sends `PUT /budgets` via `apiClient`, and invalidates `['budgets', { month }]` after success.
- AC traceability: AC1 via dashboard page and four sections; AC2 via dashboard hooks and apiClient scan; AC3 via page month state and query keys; AC4 via selected-currency rendering and CAD-only budgets; AC5 via `formatMoney` usage and guardrail scan; AC6 via `SectionFrame` states and section tests; AC7 via `BudgetsSection` mutation and invalidation test; AC8 via web typecheck/test/build evidence; AC9 via chart labels/legends, zero-filled trend rendering from `months`, readable labels, and successful build.
- Verification evidence:
  - `pnpm --filter @clarifi/web typecheck` — passed before and after review fix (`tsc --noEmit`).
  - `pnpm --filter @clarifi/web test` — passed before and after review fix (4 files, 11 tests).
  - `pnpm --filter @clarifi/web build` — passed before and after review fix (Next.js 16.2.9; routes `/`, `/api/[...path]`, `/dashboard`, `/sign-in`, `/sign-up`).
- Environment note: commands emitted the existing Node warning because this shell is `v20.16.0` while the repo wants `>=20.19`; the requested gates still completed as recorded.

### File List
- `_bmad-output/implementation-artifacts/3-6-spending-dashboard-ui.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/web/src/app/(app)/dashboard/page.tsx`
- `apps/web/src/features/dashboard/budgets-section.tsx`
- `apps/web/src/features/dashboard/cash-flow-summary-section.tsx`
- `apps/web/src/features/dashboard/category-breakdown-section.tsx`
- `apps/web/src/features/dashboard/dashboard-sections.test.tsx`
- `apps/web/src/features/dashboard/dashboard-utils.ts`
- `apps/web/src/features/dashboard/hooks.ts`
- `apps/web/src/features/dashboard/section-frame.tsx`
- `apps/web/src/features/dashboard/spending-trend-section.tsx`
- `apps/web/src/features/dashboard/types.ts`

## Change Log

- 2026-06-17: Story created (ready-for-dev). Scope is the spending dashboard UI rendering the 3.1–3.4 APIs through the 3.5 foundation — category donut, 6-month trend, cash-flow summary, and budget progress + set form — per-currency, money display-only, with loading/error/empty states. Frontend only; no backend or schema change. Completes Epic 3's deferred UI deliverable. Not implemented.
- 2026-06-17: Implemented dashboard UI and moved story to review. Added typed query hooks, dashboard state/layout, category/trend/summary/budget sections, budget mutation invalidation, and component tests.
- 2026-06-17: Completed code review fix and marked story done. Zero MoM deltas now render neutrally; web typecheck, tests, and build pass.
