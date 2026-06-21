---
risk_tier: 2
baseline_commit: 55754af
context:
  - _bmad-output/planning-artifacts/epics/epic-11-ux-refinement.md#Story 11.2
  - docs/design-reference.md
  - apps/web/src/app/(app)/dashboard/page.tsx
  - apps/web/src/features/dashboard/section-frame.tsx
  - apps/web/src/features/dashboard/cash-flow-summary-section.tsx
  - apps/web/src/features/anomaly/anomaly-feed.tsx
  - apps/web/src/features/anomaly/anomaly.hooks.ts
  - apps/web/src/features/notifications/notification.hooks.ts
  - apps/web/src/features/notifications/notification.types.ts
  - apps/web/src/app/(app)/anomalies/page.tsx
  - CLAUDE.md
---

# Story 11.2: Anomaly insights — dashboard card + dedicated triage page

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want a glanceable anomaly summary on my dashboard and a focused page for working through anomalies,
so that critical issues catch my eye without cluttering the dashboard, and I still have room to triage them properly.

**Scope note:** Web-only, presentational. Add **one new summary card** to the
dashboard that **reads already-detected anomalies** via the existing
`useCriticalAnomalies()` hook and links to `/anomalies`. The `/anomalies` page and
`AnomalyFeed` (the dismiss/report triage workspace) are **left exactly as they are**.
**No new endpoint, no detection logic, no LLM call, no backend/schema change.** The
card is read-only — it surfaces existing data; it does not dismiss, report, or mutate.

## Acceptance Criteria

1. **Dashboard "Anomaly insights" card.** A new card renders on `/dashboard` titled "Anomaly insights" (or similar), built with the existing `SectionFrame` chrome so its pending/error/empty states match the other dashboard sections. It shows a small number of **recent critical anomalies** (e.g. up to ~3) as list rows with severity affordance (reuse the `Badge` tone / severity-border pattern from `AnomalyFeed`) plus a glanceable **count/severity summary** (e.g. "N critical").
2. **Reads existing data only — no new fetch path, no LLM.** The card reuses the existing **`useCriticalAnomalies()`** hook (`features/notifications/notification.hooks.ts`, `/anomalies?severity=critical&limit=10`) so it shares the React-Query cache with the `NotificationBell` (no duplicate request, no new query key). It performs **no detection** and triggers **no LLM/explanation work** on render — it displays whatever the endpoint already returns.
3. **Links through to the full page.** The card has a clear "View all anomalies" affordance (e.g. `SectionFrame` `footer` with a `Link href="/anomalies"`) routing to the dedicated page.
4. **Empty + loading states.** When there are no critical anomalies, the card shows a calm empty state ("No critical anomalies" / "Your spending looks normal") via `SectionFrame`'s empty handling — it does not render an empty/broken shell. Loading and error states come from `SectionFrame`.
5. **Triage page unchanged.** `/anomalies` and `AnomalyFeed` keep the full list and the dismiss/report → per-merchant adaptive-tuning behaviour exactly as today. Detection, feedback, and the anomaly endpoints are **not modified**.
6. **Money display discipline.** Any amounts in the card are display-only and per-currency, formatted via the shared `formatMoney` (as `AnomalyFeed` does). **No arithmetic, no cross-currency aggregation** — the "count" is a count of anomalies, never a summed amount across currencies.
7. **Tests + gate.** A test covers the card: rendering critical anomalies (with the count and the `/anomalies` link) and the empty state, mocking `useCriticalAnomalies`. Existing dashboard/anomaly tests still pass. `pnpm verify:story:web` exits 0 (scope guard + web typecheck + web test with zero skips + Next/Tailwind build). No DB needed.

## Tasks / Subtasks

- [ ] Task 1: Build the anomaly-insights card (AC: #1, #2, #4, #6)
  - [ ] New `apps/web/src/features/dashboard/anomaly-insights-section.tsx` (mirrors the other `*-section.tsx` files): consume `useCriticalAnomalies()`, render up to ~3 rows + a count summary inside `SectionFrame`. Reuse `Badge`/severity tone and `formatMoney`; do **not** render dismiss/report controls.
- [ ] Task 2: Wire the "View all" link (AC: #3)
  - [ ] Pass a `footer` with `Link href="/anomalies"` ("View all anomalies →") to `SectionFrame`.
- [ ] Task 3: Place the card on the dashboard (AC: #1)
  - [ ] Add the section to `apps/web/src/app/(app)/dashboard/page.tsx` in a sensible position (e.g. near the top or after the category/trend grid). Keep the existing sections, `#budgets` anchor, month/currency controls untouched.
- [ ] Task 4: Confirm the triage page is untouched (AC: #5)
  - [ ] No edits to `/anomalies/page.tsx`, `anomaly-feed.tsx`, or `anomaly.hooks.ts` beyond (optionally) extracting a shared severity/summary helper — see reuse note. Behaviour identical.
- [ ] Task 5: Test + verify (AC: #7)
  - [ ] Add a card test (mock `useCriticalAnomalies`): asserts rows + count + the `/anomalies` link render, and the empty state. Run `pnpm verify:story:web` (exit 0). Optionally drive via `run`/`verify` (dashboard shows the card → click through to `/anomalies`).

## Dev Notes

### Risk Tier

Tier 2. Web-only, presentational; one new section component + a dashboard-page wiring
line + a test, reading an **existing** endpoint through an **existing** hook. **No
guardrail surface** — no money math/`_cents` arithmetic, no RLS/`withUserContext`, no
LLM gateway, no idempotency key, no Prisma migration, no outbox/webhook. Guardrail
tripwire: `git diff --name-only` must stay within `apps/web/src/` (the new section,
the dashboard page, the test, and at most a small shared anomaly-presentation helper).
Any touch to `apps/api`, `packages/shared`, `prisma/`, or detection logic — stop, out
of scope.

### Source Story Context

Second story of Epic 11. Today anomalies live only on `/anomalies` (full
`AnomalyFeed` with dismiss/report). The brainstorm decision (Lawrence, 2026-06-21)
was **card + page**: a glanceable hero card on the dashboard, the dedicated page kept
as the triage workspace. This story adds only the card.
[Source: epic-11-ux-refinement.md#Story 11.2]

### Architecture Guardrails

- **Reuse the existing read hook — do not add a new query.** `useCriticalAnomalies()`
  already fetches `severity=critical` with the query key `["anomalies","critical"]`,
  shared with the `NotificationBell`. Reusing it means the card and bell de-dupe to a
  single request. Do **not** introduce a new endpoint or a parallel fetch.
  [Source: features/notifications/notification.hooks.ts]
- **Reuse `SectionFrame`** for card chrome (title/pending/error/empty + `footer`), so
  the card matches `CashFlowSummarySection` et al. [Source: features/dashboard/section-frame.tsx]
- **Reuse presentation, don't duplicate.** Severity → tone/border and the
  `anomalySummary()` string live in `anomaly-feed.tsx`. Prefer extracting the small
  helpers (e.g. `severityTone`, `anomalySummary`) into a shared module
  (`features/anomaly/anomaly-presentation.ts`) and importing from both — but if you
  extract, the feed must import the extracted version (no copy-paste fork).
  [Source: features/anomaly/anomaly-feed.tsx]
- **Summary-only / read-only.** The card must not render dismiss/report or call any
  mutation; triage stays on the page. No LLM/explanation is triggered on render — the
  card shows whatever `explanation`/fields the endpoint already returns. [Source: epic-11-ux-refinement.md#Story 11.2]
- **Money display-only, per-currency** via `formatMoney`; never sum amounts across
  currencies; the "count" is a row count, not a money total. [Source: CLAUDE.md — money guardrail]
- **Client-safe imports only** — dashboard/card are client components; never import
  from the `@clarifi/shared` root barrel. [Source: project-context.md — Epic 3/4 learning]

### Implementation Guidance

- Keep the card compact: a count/severity line + up to ~3 most-recent critical rows +
  the "View all" footer. The full list stays on `/anomalies`.
- `useCriticalAnomalies` polls (60s) and may load after first paint — rely on
  `SectionFrame`'s `isPending`/`error`/`isEmpty` props rather than hand-rolling states.
- Placement: add the `<AnomalyInsightsSection />` to the dashboard grid as its own
  `<section>`; do not disturb the month/currency controls, the chart grid, the
  cash-flow section, or the `#budgets` anchor section.

### Testing Standards

- Vitest + RTL + jsdom. Mock `useCriticalAnomalies` (return critical anomalies, then
  an empty list). Assert: rows render with severity affordance, the count summary
  shows, the "View all" `Link` points at `/anomalies`, and the empty state renders
  when there are none. No real network. Gates: web typecheck, web test (zero skips),
  build — via `pnpm verify:story:web`.

### Project Structure Notes

New file: `apps/web/src/features/dashboard/anomaly-insights-section.tsx` (+ its test;
optionally `features/anomaly/anomaly-presentation.ts` if extracting shared helpers).
Modified: `apps/web/src/app/(app)/dashboard/page.tsx` (add the section). The
`/anomalies` page, `AnomalyFeed`, and anomaly hooks are untouched (except an optional
shared-helper import). No backend/schema/API change; no new deps.

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-11-ux-refinement.md#Story 11.2]
- [Source: docs/design-reference.md §5–§6]
- [Source: apps/web/src/features/notifications/notification.hooks.ts (useCriticalAnomalies)]
- [Source: apps/web/src/features/dashboard/section-frame.tsx]
- [Source: apps/web/src/features/dashboard/cash-flow-summary-section.tsx (section pattern)]
- [Source: apps/web/src/features/anomaly/anomaly-feed.tsx (severity tone + summary)]
- [Source: apps/web/src/app/(app)/dashboard/page.tsx]
- [Source: apps/web/src/app/(app)/anomalies/page.tsx]
- [Source: CLAUDE.md]

## Pre-Review Due Diligence

**Complete this self-review before marking the story for review.** This repo's code
review runs three lenses — Blind Hunter (context-free bugs), Edge Case Hunter
(boundaries), Acceptance Auditor (AC coverage). Pre-empt them here:

- **AC → test/gate traceability (Acceptance Auditor):** map each AC #1–#7 to a test or gate. Load-bearing: #2 (reuses `useCriticalAnomalies`, no new fetch, no LLM on render), #5 (triage page unchanged), #6 (no cross-currency aggregation). Cover #1/#3/#4 with the card test; confirm #2/#5 by `git diff` (no new hook/endpoint, no edits to the feed/page) and a manual run note.
- **Guardrail tripwire (Tier 2):** run `git diff --name-only`; confirm it stays within `apps/web/src/` (new section + test, dashboard page, optional shared helper). Explicitly confirm **zero** touches to `apps/api`, `packages/shared`, `prisma/`, money/`_cents` arithmetic, RLS, the LLM gateway, or anomaly detection/endpoint code.
- **Edge / failure paths (Edge Case Hunter):** empty critical list → calm empty state (not a broken card); loading and error states render via `SectionFrame`; an anomaly with `amountCents === 0` or a null `merchantName` renders without crashing (mirror `AnomalyFeed`'s guards); mixed currencies across rows each format with their own currency (never combined); the card never shows dismiss/report controls.
- **Reuse first (Blind Hunter / simplify):** reuse `useCriticalAnomalies`, `SectionFrame`, `Badge`, `formatMoney`, and the severity/summary helpers (extract-and-share, don't copy). Do not add a second anomalies query, a new endpoint, or a duplicated summary function.
- **Scope discipline:** add only the dashboard card — no restyle of other screens (11.3), no nav change (11.1), no edits to the triage page/feed behaviour, no new mutations.
- **Evidence, not claims:** paste the actual `pnpm verify:story:web` summary (web typecheck + web test counts, zero skips, build exit 0) into Completion Notes; note the manual run (dashboard card → click through to `/anomalies`) if performed.

## Dev Agent Record

### Agent Model Used
_TBD_

### Completion Notes List
_TBD_

### File List
_TBD_

## Change Log

- 2026-06-21: Story created (ready-for-dev), second story of Epic 11. Scope is a read-only "Anomaly insights" dashboard card reusing `useCriticalAnomalies` + `SectionFrame`, linking to the unchanged `/anomalies` triage page. Presentational/web-only, no guardrail surface, no new endpoint, no behaviour change. Not implemented.
