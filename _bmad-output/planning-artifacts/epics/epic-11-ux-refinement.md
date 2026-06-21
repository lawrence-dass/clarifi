# Epic 11: UX Refinement

Tighten the app's information architecture and close the remaining cosmetic gap
to the bank-grade reference (`docs/design-reference.md`, the IBM-Carbon-style
captures in `docs/screenshots/`). Two concerns: (1) a navigation/IA restructure
that separates **destinations** from **actions** from **identity**, and (2) a
visual polish pass that makes buttons, cards, density, and metric styling read as
crisp as the reference. **Presentational/IA only** — no API, schema, or
business-logic change. Money/currency display discipline (integer cents formatted
at the display layer, never combined across currencies) is preserved on every
screen. Builds on the Epic 9 token foundation and primitives.

**FRs covered:** none new — UX/IA refinement of existing FR13–FR31 surfaces;
aligns with the PRD's UX Design Requirements.

## Story 11.1: Navigation & information-architecture restructure

As a user,
I want a nav that shows only real destinations, with actions and my account in
their own places,
So that the app feels intentional and uncluttered instead of a flat list of
seven mixed items.

**Acceptance Criteria:**

**Given** the current flat nav (`Dashboard · Query · Upload · Budgets · Anomalies · Consents · Account`)
**When** the shell is restructured
**Then** the primary nav contains only destinations — `Dashboard · Query · Anomalies · Consents` — with the active item shown in `primary`
**And** **Upload** is removed from the nav and becomes a primary `[+ Add data]` action button (top-right of the shell) that opens the CSV upload in a **modal/dialog** (the existing `/dashboard/upload` upload logic and idempotent-ingestion flow are reused unchanged; the standalone page may redirect to the dashboard with the modal open or be retired)
**And** **Budgets** is removed from the nav (it remains a section on the Dashboard reachable by in-page anchor/tab, not a top-level item)
**And** **Account** is removed from the nav and folded into a user menu hung off the email/avatar in the shell, relabeled **"Profile & settings"**, housing the account info currently shown top-left (email), the PIPEDA data-export/delete action, and **Sign out** (the deletion flow and its end-to-end guarantees are unchanged)
**And** the floating email string previously top-left is given its home in that user menu
**And** all routing, auth, and the notification bell continue to work; responsive layout holds; typecheck and the web test suite (including `app-shell.test.tsx`, updated to the new structure) pass.

## Story 11.2: Anomaly insights — dashboard card + dedicated triage page

As a user,
I want a glanceable anomaly summary on my dashboard and a focused page for working
through anomalies,
So that critical issues catch my eye without cluttering the dashboard, and I still
have room to triage them properly.

**Acceptance Criteria:**

**Given** the Epic 5 anomaly feed and detection/feedback APIs
**When** I open the Dashboard
**Then** an **"Anomaly insights" card** renders as a glanceable entry point — recent critical anomalies plus a count/severity summary — using the Epic 9 list-row + severity primitives, and links through to the full page
**And** the dedicated `/anomalies` page remains the triage workspace where dismiss/report drive the per-merchant adaptive sensitivity model (behaviour unchanged from Epic 5)
**And** the card is summary-only (no detection logic, no LLM call on render — it reads already-detected anomalies); money stays display-only and per-currency
**And** typecheck and the web test suite pass.

## Story 11.3: Visual polish pass — crisp enterprise styling

As a user,
I want buttons, cards, and metrics to look as crisp as the reference dashboards,
So that Clarifi reads as a trustworthy, bank-grade product.

**Acceptance Criteria:**

**Given** the Epic 9 tokens/primitives and the reference (`docs/design-reference.md`, `docs/screenshots/`)
**When** the polish pass is applied
**Then** corner radii tighten toward the reference (near-square, ~2px), the `Button` primary becomes a solid crisp fill with a clear outline secondary, card chrome shifts from soft shadow toward thin 1px hairline borders, and the UPPERCASE micro-label + KPI metric-with-delta styling matches the reference stat cards
**And** changes are made at the token/primitive layer so they propagate across screens (Dashboard, Query, Anomalies, Consents, auth, modals) without per-screen rewrites
**And** APIs and component contracts are unchanged; money/currency display discipline is preserved; typecheck, the web test suite, and a Tailwind compile pass.
