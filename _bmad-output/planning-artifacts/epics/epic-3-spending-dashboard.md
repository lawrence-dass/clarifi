# Epic 3: Spending Dashboard

Users see where their money goes.

## Story 3.1: Monthly category breakdown

As a user,
I want a donut chart of spend by category for a month,
So that I see my biggest categories.

**Acceptance Criteria:**

**Given** categorized transactions for a month
**When** I open the dashboard
**Then** a per-currency category breakdown renders (no cross-currency summing)
**And** the API responds in under 500ms for a typical dataset.

## Story 3.2: Spending trend over time

As a user,
I want a 6-month spending trend line,
So that I see whether spending is rising.

**Acceptance Criteria:**

**Given** at least one month of data
**When** I view the trend
**Then** monthly totals for the last 6 months render per currency
**And** months with no data show zero, not gaps.

## Story 3.3: Top merchants, income vs expenses, month-over-month

As a user,
I want top merchants and an income/expense summary with MoM comparison,
So that I understand my cash flow.

**Acceptance Criteria:**

**Given** categorized, signed transactions
**When** I view the summary
**Then** top merchants by spend, total income vs expenses, and per-category month-over-month deltas are shown
**And** inflows (positive) and outflows (negative) are correctly separated.

## Story 3.4: Per-category budgets & progress

As a user,
I want to set a monthly budget per category and see progress,
So that I can control spending.

**Acceptance Criteria:**

**Given** a category
**When** I set a monthly limit (integer cents)
**Then** a Budget row is created for that category/month and progress is shown as spent/limit
**And** progress recomputes as new transactions arrive.

<!-- Stories 3.5–3.6 added 2026-06-17: stories 3.1–3.4 were scoped backend-only,
deferring this epic's frontend deliverable (FR13–FR17 include rendering). These
decompose the deferred UI into a web foundation plus the dashboard views. The
architecture has no standalone UI epic — each feature epic owns its frontend slice. -->

## Story 3.5: Web app foundation & shell

As a user,
I want to sign in and land in an authenticated app shell,
So that I can reach the spending dashboard and other features.

**Acceptance Criteria:**

**Given** a registered user
**When** they sign in through the web app
**Then** the session is established via the existing httpOnly-cookie auth and protected pages are reachable
**And** the app provides the shared client foundation (data-fetching provider, API client, charting + UI primitives, loading/error conventions) the dashboard and later feature UIs build on.

## Story 3.6: Spending dashboard UI

As a user,
I want a dashboard that renders my category breakdown, spending trend, cash-flow summary, and budgets,
So that I can actually see where my money goes.

**Acceptance Criteria:**

**Given** authenticated transaction data
**When** I open the dashboard
**Then** the Story 3.1–3.4 APIs are rendered (per-currency category donut, 6-month trend, income/expense + top merchants + MoM deltas, and budget progress)
**And** money is formatted at the display layer only, per currency, with loading/error/empty states.
