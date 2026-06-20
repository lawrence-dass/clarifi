# Epic 9: UI Redesign

Refresh the Clarifi web UI onto a cohesive, bank-grade design system derived from
the reference captured in `docs/design-reference.md`. A shared token + primitive
foundation, then a screen-by-screen rollout. **Presentational only** — no API,
schema, or business-logic change. Money/currency display discipline (integer cents
formatted at the display layer, never combined across currencies) is preserved on
every screen.

**FRs covered:** none new — visual/UX refresh of the existing FR13–FR31 surfaces;
aligns with the PRD's UX Design Requirements.

## Story 9.1: Design-token foundation & UI primitives

As a user,
I want a consistent visual language across the app,
So that Clarifi looks trustworthy and polished.

**Acceptance Criteria:**

**Given** the reference design system in `docs/design-reference.md`
**When** the foundation is in place
**Then** color/type/shape tokens exist as CSS variables wired into Tailwind (neutrals, royal-blue primary, semantic + categorical hues, the UPPERCASE micro-label and KPI type sizes, tight radii, card/modal shadows), Inter is loaded, and the app canvas uses the tokens
**And** the shared primitives are restyled to the tokens (Button, Card, Input, Skeleton) with APIs unchanged, plus new primitives covering the reference catalogue (Label, Badge, StatDelta, KpiTile, Progress, SegmentedBar)
**And** typecheck, the web test suite, and a Tailwind compile pass.

## Story 9.2: App shell & navigation

As a user,
I want a clean, consistent shell around every page,
So that navigation feels coherent and current location is obvious.

**Acceptance Criteria:**

**Given** the token foundation (9.1)
**When** I move through authenticated pages
**Then** the app shell uses `canvas`/`surface` tokens, the active nav item is shown in `primary`, and the header/nav/notification-bell/sign-out adopt the new primitives
**And** layout is responsive and no existing route or auth behaviour changes.

## Story 9.3: Dashboard restyle

As a user,
I want the spending dashboard to use the new design language,
So that my finances read as clearly as the reference dashboards.

**Acceptance Criteria:**

**Given** the existing dashboard data (Stories 3.1–3.4 APIs)
**When** I open `/dashboard`
**Then** the summary renders as KPI tiles (label → value → colored delta), the category breakdown can use the segmented bar + legend, budgets use the Progress primitive, and recent items use list-row styling
**And** money stays display-only and per-currency (no arithmetic, no cross-currency combining) — data access is unchanged.

## Story 9.4: Budgets restyle

As a user,
I want budget progress to read at a glance,
So that I can tell when I'm approaching or over a limit.

**Acceptance Criteria:**

**Given** budget data with `percentUsed`
**When** I view budgets
**Then** each row uses the Progress primitive with tone shifting success → warning (≈80%) → danger (≥100%), the real value/percent is shown (bar clamped for display only)
**And** the set-budget form uses the restyled Input/Label/Button; no API or validation change.

## Story 9.5: Auth screens restyle

As a user,
I want sign-in and sign-up to look clean and trustworthy,
So that my first impression of Clarifi is strong.

**Acceptance Criteria:**

**Given** the auth pages
**When** I sign in or sign up
**Then** they adopt the reference auth layout (title + subtitle, UPPERCASE field labels, full-width solid primary) using the restyled primitives
**And** existing form validation, error states, and auth flow are unchanged.

## Story 9.6: NL-query chat restyle

As a user,
I want the query chat to use the new design language,
So that questions, interpretations, and answers are easy to read.

**Acceptance Criteria:**

**Given** the Epic 6 NL-query UI
**When** I ask a question
**Then** Q→A turns use the activity-feed framing, the echoed interpretation is shown as a quiet muted caption, and results render via the restyled table/chart primitives
**And** the NL→IR→SQL flow, guardrails, and data access are unchanged.

## Story 9.7: Anomaly feed restyle

As a user,
I want the anomaly feed to communicate severity clearly,
So that critical anomalies stand out.

**Acceptance Criteria:**

**Given** the Epic 5 anomaly feed
**When** I view anomalies
**Then** rows use list-row styling with severity color (info/warning/critical → badge/border tone), the async explanation uses the feed/activity pattern, and dismiss/report use the restyled buttons
**And** detection/feedback behaviour is unchanged.

## Story 9.8: Notifications restyle

As a user,
I want notifications to match the rest of the app,
So that alerts feel native and legible.

**Acceptance Criteria:**

**Given** the notification bell/panel (Epic 8)
**When** I open notifications
**Then** items use the activity-feed pattern with an unread indicator in `primary`, using the restyled primitives
**And** notification data and read/unread behaviour are unchanged.

## Story 9.9: Consents dashboard restyle

As a user,
I want the consent dashboard to look clear and reassuring,
So that I trust how my bank connections are managed.

**Acceptance Criteria:**

**Given** the Epic 7 consent dashboard
**When** I view connected providers/scopes
**Then** providers render as list rows with status badges, grant/scope detail uses the modal pattern, and revoke uses a `danger` action
**And** the OAuth2 consent/grant/scope/revoke flow is unchanged.

## Story 9.10: Account & settings restyle

As a user,
I want the account page (incl. data deletion) to match the redesign,
So that important actions are clear and safe.

**Acceptance Criteria:**

**Given** the account page (incl. PIPEDA data deletion)
**When** I view or manage my account
**Then** it uses the restyled form layout and the destructive delete is a `danger` action behind a confirmation modal
**And** the deletion flow and its end-to-end guarantees are unchanged.
