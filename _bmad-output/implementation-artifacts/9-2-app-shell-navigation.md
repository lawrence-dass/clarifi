---
risk_tier: 1
baseline_commit: 5445752
context:
  - _bmad-output/planning-artifacts/epics/epic-9-ui-redesign.md#Story 9.2
  - docs/design-reference.md
  - apps/web/src/components/app-shell.tsx
  - apps/web/src/components/ui/button.tsx
  - apps/web/src/features/notifications/notification-bell.tsx
  - CLAUDE.md
---

# Story 9.2: App shell & navigation

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want a clean, consistent shell around every page,
so that navigation feels coherent and my current location is obvious.

**Scope note:** Web-only, presentational. Restyle the existing app shell
(`apps/web/src/components/app-shell.tsx`) onto the 9.1 token foundation. No route,
auth, data, or navigation-behaviour change — only visual/structural styling and the
active-state affordance.

## Acceptance Criteria

1. The shell uses the design tokens: page background `bg-canvas`, header/surfaces `bg-surface` with `border` hairlines (replacing the current `slate-*` utilities). The "Clarifi" wordmark and the user email use token text colors (`text`/`text-muted`).
2. **Active nav state:** the nav item matching the current route is visually marked in `primary` (e.g. `text-primary` + an active background/indicator); inactive items use `text-muted` with a `hover:bg-canvas hover:text-text` affordance. Active detection uses Next's `usePathname` (handle the `/dashboard` parent vs. child routes sensibly — exact match for top-level items).
3. The sign-out control uses the restyled `Button` (`variant="outline"`); the `NotificationBell` continues to render in the nav and is visually consistent (no behaviour change).
4. Layout is responsive: the nav wraps/collapses gracefully on narrow widths as it does today (no horizontal overflow); the content container keeps a sensible max width and padding using tokens.
5. **No behaviour change:** routes, links, the `useSession`/`useLogout` flow, and the redirect-on-sign-out are unchanged. No new dependency.
6. **Quality gate:** `pnpm verify:story:web` exits 0 — the web-only gate (scope guard + web typecheck + web test with zero skips + Next/Tailwind production build). No DB needed for this story.

## Tasks / Subtasks

- [ ] Task 1: Restyle shell chrome (AC: #1, #4)
  - [ ] Swap `slate-*` for tokens in `app-shell.tsx` (canvas/surface/border/text). Keep the max-width container + padding (tokenized).
- [ ] Task 2: Active nav state (AC: #2)
  - [ ] Use `usePathname` to mark the active item in `primary`; inactive items muted with hover affordance. Exact match for top-level nav hrefs.
- [ ] Task 3: Controls (AC: #3)
  - [ ] Sign-out via restyled `Button variant="outline"`; verify `NotificationBell` sits consistently.
- [ ] Task 4: Verify (AC: #5, #6)
  - [ ] Confirm no route/auth/data change; run `pnpm verify:story:web` (exit 0). Optionally drive via the `run`/`verify` skills (sign in → shell renders, active item highlights, sign-out redirects).

## Dev Notes

### Risk Tier

Tier 1. Isolated, reversible, presentational; a single component (`app-shell.tsx`)
plus token usage. No guardrail surface — no money, RLS, gateway, migrations, or
outbox. Guardrail tripwire: `git diff --name-only` should stay within
`apps/web/src/components/app-shell.tsx` (and, if needed, a tiny `cn`-based active
helper). If the diff reaches `apps/api`, `packages/shared`, or any data layer —
stop, out of scope.

### Source Story Context

Second story of Epic 9; builds directly on the 9.1 tokens/primitives. The current
shell is `apps/web/src/components/app-shell.tsx` (top bar: wordmark + email, nav
links, `NotificationBell`, sign-out Button). [Source: epic-9-ui-redesign.md#Story 9.2]

### Architecture Guardrails

- **Reuse 9.1 primitives/tokens** — do not introduce new colors outside the token
  set or a second button style. [Source: docs/design-reference.md]
- **Client-safe imports only** — the shell is a client component; don't import from
  the `@clarifi/shared` root barrel (pulls Prisma into the bundle). [Source: project-context.md — Epic 3/4 learning]
- **No behaviour drift** — `useSession`/`useLogout` and routing stay exactly as-is.

### Implementation Guidance

- Active state: `const pathname = usePathname();` then `const active = pathname === item.href;` for top-level items. If a sidebar layout is desired later, keep this story to the existing top-bar structure (don't redesign navigation IA here — that's not in scope).
- Keep the wordmark simple (text). A logo mark is out of scope.

### Testing Standards

- Vitest + RTL + jsdom. If adding a test, render the shell with a mocked
  `usePathname`/session and assert the active item carries the `primary` affordance
  and inactive items don't. No real network. Otherwise rely on the existing suite +
  build. Gates: typecheck, test, build.

### Project Structure Notes

Change is confined to `apps/web/src/components/app-shell.tsx` (optionally a small
local helper). No new files required; no backend/schema/API change; no new deps.

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-9-ui-redesign.md#Story 9.2]
- [Source: docs/design-reference.md §5.2, §6]
- [Source: apps/web/src/components/app-shell.tsx]
- [Source: apps/web/src/components/ui/button.tsx]
- [Source: CLAUDE.md]

## Pre-Review Due Diligence

**Complete this self-review before marking the story for review.** This repo's code
review runs three lenses — Blind Hunter (context-free bugs), Edge Case Hunter
(boundaries), Acceptance Auditor (AC coverage). Pre-empt them here:

- **AC → test/gate traceability (Acceptance Auditor):** map each AC #1–#6 to the diff or a gate. Active-state (#2) and no-behaviour-change (#5) are the load-bearing ACs — confirm them explicitly (a test for #2 if practical; a manual run note for #5).
- **Guardrail tripwire (Tier 1):** run `git diff --name-only`; confirm it stays web-only and within the shell (no `apps/api`, no `packages/shared`, no data layer, no money/RLS/gateway/migration/outbox touch).
- **Edge / failure paths (Edge Case Hunter):** active highlighting on `/dashboard` vs child routes (e.g. `/dashboard/upload`) — top-level exact match shouldn't double-highlight or drop highlight unexpectedly; narrow viewport nav wrap (no overflow); signed-out/loading session (email absent) renders without layout break; sign-out still redirects.
- **Reuse first (Blind Hunter / simplify):** use the 9.1 `Button` and tokens; don't hand-roll a new button or off-token colors; don't duplicate `cn`.
- **Scope discipline:** restyle only — no navigation IA redesign, no new routes, no logo asset. Flag any backend touch (there should be none).
- **Evidence, not claims:** paste the actual `pnpm verify:story:web` summary (typecheck + web test + build, exit 0) into Completion Notes; note the manual run if used.

## Dev Agent Record

### Agent Model Used
_TBD_

### Completion Notes List
_TBD_

### File List
_TBD_

## Change Log

- 2026-06-19: Story created (ready-for-dev) as part of opening Epic 9. Scope is the presentational restyle of the app shell onto the 9.1 tokens with an active-nav affordance; no behaviour change. Not implemented.
