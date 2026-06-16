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
