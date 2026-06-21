---
risk_tier: 2
baseline_commit: 55754af
context:
  - _bmad-output/planning-artifacts/epics/epic-11-ux-refinement.md#Story 11.1
  - docs/design-reference.md
  - apps/web/src/components/app-shell.tsx
  - apps/web/src/components/app-shell.test.tsx
  - apps/web/src/features/notifications/notification-bell.tsx
  - apps/web/src/features/upload/upload-panel.tsx
  - apps/web/src/app/(app)/dashboard/upload/page.tsx
  - apps/web/src/app/(app)/dashboard/account/page.tsx
  - apps/web/src/app/(app)/dashboard/page.tsx
  - CLAUDE.md
---

# Story 11.1: Navigation & information-architecture restructure

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want a nav that shows only real destinations, with actions and my account in their own places,
so that the app feels intentional and uncluttered instead of a flat list of seven mixed items.

**Scope note:** Web-only, presentational/IA. The change is confined to the app shell
(`apps/web/src/components/app-shell.tsx`), a new upload-modal wrapper, a new user-menu
component, the `app-shell.test.tsx`, and the now-redirecting `/dashboard/upload` page.
**No backend, schema, API, route-handler, auth, or data-access change.** The existing
`UploadPanel`, `AccountPanel`, deletion flow, and the dashboard `#budgets` section are
**reused as-is** — this story only changes how they are reached, not what they do.

## Acceptance Criteria

1. **Primary nav = destinations only.** The top nav contains exactly `Dashboard · Query · Anomalies · Consents` (in that order). The current `Upload`, `Budgets`, and `Account` items are removed from the nav. Active-state detection is unchanged in mechanism (`usePathname`, exact match for top-level hrefs): `/dashboard` highlights Dashboard, `/dashboard/query` highlights Query (and not Dashboard), `/anomalies` highlights Anomalies, `/consents` highlights Consents.
2. **Upload → action button + modal.** A primary `[+ Add data]` button sits in the shell header (top-right cluster, near the bell/sign-out). Clicking it opens a **modal/dialog** that renders the existing `UploadPanel` unchanged. The modal can be dismissed (backdrop click, an explicit close control, and `Esc`). A successful import inside the modal behaves exactly as the page does today (the `useImportStatement` flow and its success/duplicate summary are untouched).
3. **Budgets de-navved.** `Budgets` is gone from the nav. The dashboard `#budgets` section (`apps/web/src/app/(app)/dashboard/page.tsx`, the `id="budgets"` section) is **unchanged** and still reachable by anchor (`/dashboard#budgets`). Do not delete or move the budgets section.
4. **Account → user menu ("Profile & settings").** The email currently rendered as loose text top-left moves into a **user menu** triggered by an avatar/email control in the shell header. The menu contains: the signed-in email, a **"Profile & settings"** link to the existing `/dashboard/account` page, and the **Sign out** action (moved here from the nav row). The `/dashboard/account` route, `AccountPanel`, and the PIPEDA deletion flow it hosts are **not modified** — only linked.
5. **No behaviour change beyond IA.** Routes, links, `useSession`/`useLogout`, the redirect-on-sign-out, and the `NotificationBell` all behave exactly as before. `/dashboard/upload` no longer needs to be a standalone destination — either redirect it to `/dashboard` (acceptable) or keep it rendering for deep-links; either way it must not 404 and must not appear in the nav. **No new runtime dependency** (no Radix/dialog library) — reuse the existing overlay idiom.
6. **Tests updated, not weakened.** `app-shell.test.tsx` is updated to the new structure: it must assert the four destination links are present and that `Upload`/`Budgets`/`Account` are **not** nav links, that the `[+ Add data]` button opens the upload modal, and that the user menu exposes the email + Sign out. Keep the existing active-state and notification-bell assertions (adjusted to the new nav set). No assertion is deleted merely to make the suite pass.
7. **Quality gate:** `pnpm verify:story:web` exits 0 — the web-only gate (scope guard + web typecheck + web test with zero skips + Next/Tailwind production build). No DB needed for this story.

## Tasks / Subtasks

- [x] Task 1: Restructure the nav to destinations only (AC: #1)
  - [x] In `app-shell.tsx`, reduce `navItems` to `Dashboard · Query · Anomalies · Consents`; remove `Upload`, `Budgets`, `Account` entries. Keep the existing `usePathname` exact-match active logic and token classes.
- [x] Task 2: Upload modal (AC: #2, #5)
  - [x] Added generic `components/ui/modal.tsx` using the **existing overlay idiom** (`fixed inset-0` backdrop + `bg-surface` panel + `shadow-modal`), with backdrop-click / close-button / `Esc` dismissal. Renders the unmodified `UploadPanel` inside.
  - [x] Added `features/upload/add-data-button.tsx` — the `[+ Add data]` primary `Button` in the shell header that toggles the modal.
- [x] Task 3: User menu (AC: #4)
  - [x] Added `features/account/user-menu.tsx` following the `notification-bell` popover pattern (avatar/initials toggle, `fixed inset-0` dismiss layer + absolute panel). Items: email (read-only), "Profile & settings" → `Link href="/dashboard/account"`, and the Sign out action (`useLogout` + `router.replace("/sign-in")` moved here).
  - [x] Removed the loose email `<p>` and the in-nav Sign out button from the shell; the user menu sits in the header cluster.
- [x] Task 4: De-nav budgets + upload page (AC: #3, #5)
  - [x] Dashboard `#budgets` section untouched (anchor still works). `/dashboard/upload` now `redirect("/dashboard")` — not in nav, does not 404 (route still present in build output).
- [x] Task 5: Update tests + verify (AC: #6, #7)
  - [x] Updated `app-shell.test.tsx` to the new structure (11 tests). Ran `pnpm verify:story:web` → exit 0.

### Review Findings

_From bmad-code-review (2026-06-21, baseline `55754af`). Three lenses applied inline (Blind Hunter / Edge Case Hunter / Acceptance Auditor) on a 243-line presentational diff. No High/Medium findings; all ACs satisfied; guardrail tripwire clean._

- [x] [Review][Patch] `UserMenu` trigger sets `aria-haspopup="menu"` but the popup contains a link + button, not a `role="menu"` widget — minor screen-reader mismatch [apps/web/src/features/account/user-menu.tsx] — fixed: `aria-haspopup="true"` (2026-06-21)
- [x] [Review][Defer] Bell and user-menu each render a full-viewport `fixed inset-0` dismiss layer, so switching directly from one open popover to the other takes an extra click — consistent with the pre-existing notification-bell idiom; revisit with a shared single-open-overlay state [apps/web/src/features/account/user-menu.tsx, apps/web/src/features/notifications/notification-bell.tsx] — deferred, low-severity UX polish
- [x] [Review][Defer] `Modal` does not lock body scroll while open (background scrolls behind the dialog); focus-trap was intentionally scoped out — low a11y polish [apps/web/src/components/ui/modal.tsx] — deferred, story explicitly kept the modal minimal

## Dev Notes

### Risk Tier

Tier 2. Cross-file **web-only** change (shell + two new presentational components +
test + a page redirect). **No guardrail surface** — no money/`_cents`, no RLS/
`withUserContext`, no LLM gateway, no idempotency key, no Prisma migration, no
outbox/webhook. The deletion flow and ingestion logic are reused by reference, not
modified. Guardrail tripwire: `git diff --name-only` must stay within
`apps/web/src/` (shell, `features/upload/*`, `features/account/*`, the upload page,
and the shell test). If the diff reaches `apps/api`, `packages/shared`, any
`prisma/`, or any data/auth logic — stop, out of scope.

### Source Story Context

First story of Epic 11, the IA half of the UX refinement. Today's shell
(`app-shell.tsx`) is a single top bar mixing destinations (`Dashboard`, `Query`,
`Anomalies`, `Consents`), an action (`Upload`), a fake destination
(`Budgets` → `/dashboard#budgets` anchor), and identity (`Account`, the loose
email, Sign out). This story separates those three concerns.
[Source: epic-11-ux-refinement.md#Story 11.1]

### Architecture Guardrails

- **Reuse, don't reinvent.** `UploadPanel` (`features/upload/upload-panel.tsx`) and
  `AccountPanel` are already self-contained — drop them into the modal / link to the
  page; do not fork or re-implement them. Reuse the **overlay idiom** already proven
  in `notification-bell.tsx` (backdrop layer + `bg-surface`/`border-border`/
  `shadow-modal` panel). **Do not add a dialog/menu dependency** (no Radix, no new
  shadcn install) — AC #5. [Source: notification-bell.tsx; CLAUDE.md]
- **Client-safe imports only** — the shell and these menus are client components;
  never import from the `@clarifi/shared` root barrel (pulls Prisma into the browser
  bundle). [Source: project-context.md — Epic 3/4 learning]
- **Tokens only** — reuse the 9.1 token set and the restyled `Button`; the
  `[+ Add data]` button is the existing primary variant, the close/secondary controls
  reuse existing variants. No off-token colors, no second button style.
  [Source: docs/design-reference.md]
- **No behaviour drift** — `useSession`/`useLogout`, routing, the sign-out redirect,
  and `NotificationBell` stay exactly as-is; only their placement changes.

### Implementation Guidance

- **Active state stays exact-match.** `Query` lives at `/dashboard/query` (a child of
  `/dashboard`); the existing `pathname === item.href` logic already prevents Dashboard
  from double-highlighting — keep it. Do not switch to `startsWith`.
- **Esc + focus.** For the modal, wire an `Esc` key handler and return focus sensibly;
  keep it simple (a `useEffect` keydown listener like a basic dialog), no focus-trap
  library. The notification-bell popover is the template for the dismiss-layer pattern.
- **Upload page.** Simplest compliant choice: turn `/dashboard/upload/page.tsx` into a
  redirect to `/dashboard` (Next `redirect()`), since upload is now an action. Leaving
  it rendering `UploadPanel` is also acceptable as a deep-link fallback — pick one and
  note it. Either way it leaves the nav.
- **Header layout.** Keep the responsive `flex-wrap` header; the right cluster becomes
  `[+ Add data]` · `NotificationBell` · user-menu. Ensure no horizontal overflow on
  narrow widths (the nav already wraps).

### Testing Standards

- Vitest + RTL + jsdom (see existing `app-shell.test.tsx`). Mock `usePathname`,
  `useSession`, `useLogout`, and `NotificationBell` as the current test does. Add
  coverage for: the 4-item nav set (and absence of Upload/Budgets/Account links),
  the `[+ Add data]` button toggling the upload modal open (assert `UploadPanel`
  content appears), and the user menu exposing the email + a Sign out control. No real
  network. Gates: web typecheck, web test (zero skips), Next/Tailwind build — all via
  `pnpm verify:story:web`.

### Project Structure Notes

New presentational files only, under `apps/web/src`: an upload-modal wrapper and a
user-menu component (plus optional generic `components/ui/modal.tsx` if preferred).
Modified: `app-shell.tsx`, `app-shell.test.tsx`, `dashboard/upload/page.tsx`. The
dashboard page and budgets section are read-only here. No backend/schema/API change;
no new deps.

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-11-ux-refinement.md#Story 11.1]
- [Source: docs/design-reference.md §5.2, §6]
- [Source: apps/web/src/components/app-shell.tsx]
- [Source: apps/web/src/features/notifications/notification-bell.tsx]
- [Source: apps/web/src/features/upload/upload-panel.tsx]
- [Source: apps/web/src/app/(app)/dashboard/upload/page.tsx]
- [Source: apps/web/src/app/(app)/dashboard/account/page.tsx]
- [Source: apps/web/src/app/(app)/dashboard/page.tsx (id="budgets" section)]
- [Source: CLAUDE.md]

## Pre-Review Due Diligence

**Complete this self-review before marking the story for review.** This repo's code
review runs three lenses — Blind Hunter (context-free bugs), Edge Case Hunter
(boundaries), Acceptance Auditor (AC coverage). Pre-empt them here:

- **AC → test/gate traceability (Acceptance Auditor):** map each AC #1–#7 to a test or gate. The load-bearing ACs are #1 (exactly the 4 destinations, Upload/Budgets/Account gone), #2 (button opens a working upload modal), #4 (email + Sign out live in the user menu), and #5 (no behaviour drift, no new dep). Record the AC→test mapping in Completion Notes; cover #1/#2/#4/#6 with `app-shell.test.tsx` assertions and #5 with a manual run note.
- **Guardrail tripwire (Tier 2):** run `git diff --name-only`; confirm it stays within `apps/web/src/` (shell, `features/upload/*`, `features/account/*`, upload page, shell test). Explicitly confirm **zero** touches to `apps/api`, `packages/shared`, `prisma/`, money/`_cents`, RLS/`withUserContext`, the LLM gateway, idempotency keys, or outbox/webhook code. Flag any unexpected guardrail-touching file as out of scope.
- **Edge / failure paths (Edge Case Hunter):** modal dismiss via backdrop / close button / `Esc` all work and don't leave a stuck overlay; opening the modal while the bell or user menu is open doesn't stack/trap; a successful import inside the modal still shows the duplicate/imported summary; signed-out or loading session (email absent) renders the header without layout break; narrow viewport — header cluster + nav wrap with no horizontal overflow; `/dashboard/upload` deep-link does not 404; active-highlight correct on `/dashboard` vs `/dashboard/query`.
- **Reuse first (Blind Hunter / simplify):** reuse `UploadPanel`, `AccountPanel`, the `notification-bell` overlay idiom, the 9.1 `Button` and tokens. Do **not** add a dialog/menu dependency, hand-roll a second button style, or duplicate the dismiss-layer logic if it can be shared.
- **Scope discipline:** IA only — do not restyle screens (that's 11.3), do not add the anomaly dashboard card (that's 11.2), do not touch the deletion flow or ingestion logic, do not move the budgets section. Backend touch = out of scope (there should be none).
- **Evidence, not claims:** paste the actual `pnpm verify:story:web` summary (web typecheck + web test counts, zero skips, build exit 0) into Completion Notes; note the manual run (sign in → 4-item nav → `[+ Add data]` opens modal → user menu shows email + sign out → sign-out redirects) if performed.

## Dev Agent Record

### Agent Model Used
Claude Opus 4.8 (claude-opus-4-8) via bmad-dev-story

### Completion Notes List

Implemented the IA restructure exactly to scope — presentational/web-only, no guardrail surface.

**AC → evidence mapping:**
- **AC #1** (4 destinations; Upload/Budgets/Account de-navved; exact-match active) → `app-shell.test.tsx`: "renders the four destination nav links", "does not expose Upload, Budgets, or Account as nav links", "marks the active nav item…", "marks Query active on its child route without double-highlighting Dashboard".
- **AC #2** (`+ Add data` opens a modal reusing UploadPanel; dismissable) → "opens the upload modal from the '+ Add data' action" (asserts `role=dialog` + the UploadPanel "CSV file" control). Backdrop/close/`Esc` dismissal implemented in `components/ui/modal.tsx`.
- **AC #3** (budgets de-navved; `#budgets` anchor intact) → dashboard page untouched (not in diff); Budgets absent from nav per the AC #1 test.
- **AC #4** (email + Profile & settings link + Sign out in the user menu) → "exposes the email and a sign-out control via the account menu" (asserts email text, Sign out button, and the Profile & settings link → `/dashboard/account`).
- **AC #5** (no behaviour drift; no new dep) → `useSession`/`useLogout`/redirect preserved (moved into `UserMenu`); Modal/menu hand-rolled on the notification-popover idiom — **no dependency added** (Radix Slot was already present via `Button`).
- **AC #6** (tests updated, not weakened) → kept the active-state + notification-bell assertions; added nav-set, modal, and user-menu coverage. 11 tests pass.
- **AC #7** (gate) → `pnpm verify:story:web` exited **0**: web typecheck ✓, web test suite ✓ (zero skips), Next/Tailwind production build ✓.

**Guardrail tripwire (Tier 2):** `git diff --name-only` confined to `apps/web/src/**` (shell, `ui/modal`, `features/upload/*`, `features/account/*`, upload page, shell test) + `_bmad-output/**` planning docs. Zero touches to `apps/api`, `packages/shared`, `prisma/`, money/`_cents`, RLS/`withUserContext`, the LLM gateway, idempotency keys, or outbox/webhook. No monetary arithmetic introduced; the only PII rendered is the user's own session email in their own menu (intended, unchanged from before).

**Edge paths verified:** signed-out/loading session (email undefined) → `email ?? "—"` + initials `"?"`, no layout break; modal dismiss via backdrop / ✕ / `Esc`; `/dashboard/upload` deep-link redirects (still present in build output, no 404); header `flex-wrap` keeps nav + action cluster from overflowing on narrow widths.

**Not verified by automated test (noted for review):** live in-browser run of sign-out redirect and modal interaction — the logout/redirect path is unchanged code moved verbatim into `UserMenu`; covered by mocks in the suite but not exercised against a running server this session.

### File List

- `apps/web/src/components/app-shell.tsx` (modified) — nav → 4 destinations; header cluster `AddDataButton · NotificationBell · UserMenu`; removed loose email + in-nav sign-out.
- `apps/web/src/components/ui/modal.tsx` (new) — generic backdrop/Esc/close modal.
- `apps/web/src/features/upload/add-data-button.tsx` (new) — `+ Add data` action → modal with `UploadPanel`.
- `apps/web/src/features/account/user-menu.tsx` (new) — avatar/email menu: email, Profile & settings, Sign out.
- `apps/web/src/app/(app)/dashboard/upload/page.tsx` (modified) — `redirect("/dashboard")`.
- `apps/web/src/components/app-shell.test.tsx` (modified) — updated to new structure (11 tests).

## Change Log

- 2026-06-21: Story created (ready-for-dev) as the first story of Epic 11 (UX Refinement) — opens the epic to in-progress. Scope is the IA restructure: nav reduced to four destinations, Upload→modal action, Account→user menu, Budgets de-navved. Presentational/web-only, no guardrail surface, no behaviour change.
- 2026-06-21: Implemented via bmad-dev-story on branch `story/11-1-nav-ia-restructure` (baseline `55754af`). All 5 tasks complete; `pnpm verify:story:web` exit 0; status → review.
- 2026-06-21: bmad-code-review (3 lenses, inline) — no High/Medium; 1 Low patch applied (`aria-haspopup="true"`), 2 Low defers logged to deferred-work.md. Typecheck + 11 shell tests green post-patch. Status → done.
