---
risk_tier: 2
baseline_commit: cdb6ecb
context:
  - _bmad-output/planning-artifacts/epics/epic-11-ux-refinement.md#Story 11.3
  - docs/design-reference.md
  - apps/web/tailwind.config.ts
  - apps/web/src/app/globals.css
  - apps/web/src/components/ui/button.tsx
  - apps/web/src/components/ui/card.tsx
  - apps/web/src/components/ui/input.tsx
  - CLAUDE.md
---

# Story 11.3: Visual polish pass — crisp enterprise styling

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want corners and surfaces to read as crisp as the reference dashboards,
so that Clarifi looks like a trustworthy, bank-grade product rather than a softer consumer app.

**Scope note:** Web-only, presentational, **token-layer**. The Epic 9 token system
already matches `docs/design-reference.md` on color, hairline borders, minimal card
shadow, the 11px UPPERCASE micro-label, KPI font, and the solid-blue primary /
outline-secondary buttons. The one remaining gap to the reference screenshots is
**corner radius**: cards/buttons are currently `6px` and inputs `4px`, which read
softer than the near-rectangular reference. This story tightens the **`borderRadius`
token scale** so every `rounded`/`rounded-sm`/`rounded-md` surface sharpens at once,
and audits the core primitives to confirm they read crisp. **No new component, no
color/spacing/behaviour change, no per-screen edits.**

Decision (Lawrence, 2026-06-21): go to the **"Crisp ~3px"** option — cards/buttons
`6px → 4px`, inputs `4px → 3px`.

## Acceptance Criteria

1. **Radius tokens tightened** in `apps/web/tailwind.config.ts`: `sm 4px → 3px`, `DEFAULT 6px → 4px`, `md 6px → 4px`, `lg 8px → 6px`. No other token (color, shadow, font, spacing) changes.
2. **Propagation, not per-screen edits.** The change is made only at the token scale; all existing `rounded` (DEFAULT), `rounded-sm`, and `rounded-md` usages inherit the new values with no component edits. `rounded-full` usages (avatars, badges, status dots) are intentionally **unchanged** (still circular).
3. **Primitives read crisp.** `Button`, `Card`/`CardHeader`/`CardContent`, `Input`, the `Modal` (story 11.1), `Badge`, and the dashboard tiles render with the new tighter radius and remain visually correct (no clipped content, no broken corners, hairline borders intact). The solid-blue primary / outline-secondary button treatment and the KPI metric-with-delta styling are confirmed already-correct (no change needed).
4. **No regression to behaviour or layout.** No API, route, data, or component-contract change; the only diff is the token values (and, if strictly necessary, a primitive className touch — but the goal is zero component edits). No new dependency.
5. **Quality gate:** `pnpm verify:story:web` exits 0 — scope guard + web typecheck + web test (zero skips) + Next/Tailwind production build (where a bad token would surface). Because radius is a visual change with no test assertion, a **manual visual confirmation** (the `run`/`verify` skill, or a screenshot diff vs `docs/screenshots/`) is noted in Completion Notes.

## Tasks / Subtasks

- [x] Task 1: Tighten the radius token scale (AC: #1, #2)
  - [x] `tailwind.config.ts` `borderRadius`: `sm: "3px"`, `DEFAULT: "4px"`, `md: "4px"`, `lg: "6px"`. Nothing else in the config changed.
- [x] Task 2: Audit primitives at the new radius (AC: #3, #4)
  - [x] Static audit: radius usage is 100% token-based (no hardcoded `rounded-[Npx]`), so `Button`/`Card`/`Input`/`Modal`/`Badge`/KPI tiles inherit 4px and `rounded-full` (avatars, badges, dots) is untouched. No component edits needed.
- [~] Task 3: Verify (AC: #5)
  - [x] `pnpm verify:story:web` exit 0 (the production build compiled the new tokens).
  - [x] **Live visual confirmation done** — viewed `/sign-in` + `/dashboard` in Chrome; nav, `+ Add data`, avatar menu, anomaly card, crisp radius and the 32px button all confirmed by the user, who approved closing the story.

## Dev Notes

### Risk Tier

Tier 2. Web-only, presentational, token-layer. **No guardrail surface** — no money/
`_cents`, RLS, gateway, idempotency, migration, or outbox. The diff should be
essentially `tailwind.config.ts` alone. Guardrail tripwire: `git diff --name-only`
must stay within `apps/web/**` (ideally just the Tailwind config) + `_bmad-output/**`.
Any reach into `apps/api`, `packages/shared`, or data logic — stop, out of scope.

### Source Story Context

Third/last story of Epic 11. Epic 9 (stories 9.1–9.10) already implemented the token
foundation and restyled every screen; `docs/design-reference.md` is the spec it
targeted. This story closes the residual "softer than the screenshots" gap, which
analysis localized to corner radius (tokens otherwise already match the reference).
[Source: epic-11-ux-refinement.md#Story 11.3; docs/design-reference.md §4]

### Architecture Guardrails

- **Token-layer only.** Change the `borderRadius` scale; do not hand-edit `rounded-*`
  classes across components (that is what the token indirection is for). [Source: docs/design-reference.md §4]
- **Preserve the rest of the system.** Colors, the `shadow-card`/`shadow-modal`
  values (reference says the current barely-there card shadow is already the
  intended ceiling), the micro-label, and KPI styling stay exactly as they are.
- **`rounded-full` is deliberate** — avatars (user menu), badges, and status dots
  must stay circular; the token change does not affect `rounded-full`.
- No new dependency; no behaviour change.

### Implementation Guidance

- Current `borderRadius` in `tailwind.config.ts`: `sm 4px / DEFAULT 6px / md 6px /
  lg 8px`. Target: `sm 3px / DEFAULT 4px / md 4px / lg 6px`.
- Radius usage is entirely token-based (no hardcoded `rounded-[Npx]`): ~23 `rounded`,
  9 `rounded-sm`, 7 `rounded-md`, 7 `rounded-full` — so the scale edit propagates to
  all 39 non-circular surfaces and leaves the 7 circular ones alone.
- If the user later wants to tune the exact number, it is a one-line change here.

### Testing Standards

- No new unit test (radius has no behavioural assertion). The load-bearing automated
  check is the **production build** in `pnpm verify:story:web` (a malformed token
  fails the Tailwind compile). The existing web suite must stay green (zero skips).
  Visual correctness is confirmed manually and noted.

### Project Structure Notes

Expected diff: `apps/web/tailwind.config.ts` only (plus this story file). No new
files, no component edits, no backend/schema/API change, no new deps.

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-11-ux-refinement.md#Story 11.3]
- [Source: docs/design-reference.md §4 (Spacing, shape, elevation)]
- [Source: apps/web/tailwind.config.ts (borderRadius scale)]
- [Source: apps/web/src/components/ui/button.tsx, card.tsx, input.tsx]
- [Source: CLAUDE.md]

## Pre-Review Due Diligence

**Complete this self-review before marking the story for review.** This repo's code
review runs three lenses — Blind Hunter (context-free bugs), Edge Case Hunter
(boundaries), Acceptance Auditor (AC coverage). Pre-empt them here:

- **AC → gate traceability (Acceptance Auditor):** AC #1 (exact token values) and AC #2 (propagation, `rounded-full` untouched) are the load-bearing ones — confirm by reading the final `borderRadius` block and by `git diff` showing no `rounded-*` component edits. AC #5 → paste the `pnpm verify:story:web` result + the manual visual note.
- **Guardrail tripwire (Tier 2):** `git diff --name-only` should be `apps/web/tailwind.config.ts` (+ `_bmad-output/**`). Confirm zero `apps/api`/`packages/shared`/`prisma`/money/RLS/gateway touch.
- **Edge / failure paths (Edge Case Hunter):** verify `rounded-full` avatars/badges/dots still render as circles (a too-aggressive token change must not have been applied to them); confirm focus rings, modal corners, input corners, and badge pills look intentional at the new radius; check the production build actually compiled the new tokens (no silent fallback).
- **Reuse first (Blind Hunter / simplify):** make the change once at the token scale — do not sprinkle `rounded-[4px]` literals or edit individual components.
- **Scope discipline:** radius only — no color, shadow, spacing, font, or component-behaviour changes; no new component. Flag any temptation to "also fix" other visual nits as separate follow-ups.
- **Evidence, not claims:** paste the real `pnpm verify:story:web` summary and a one-line manual-visual confirmation (which screens you eyeballed vs the reference) into Completion Notes.

## Dev Agent Record

### Agent Model Used
Claude Opus 4.8 (claude-opus-4-8) via bmad-dev-story

### Completion Notes List

Single token-layer change; presentational/web-only, no guardrail surface.

**AC → evidence:**
- **AC #1** (exact token values) → `tailwind.config.ts` `borderRadius` now `sm 3px / DEFAULT 4px / md 4px / lg 6px`; no other token touched (diff is the borderRadius block only).
- **AC #2** (propagation, `rounded-full` untouched) → pre-change audit found radius usage entirely token-based (23 `rounded`, 9 `rounded-sm`, 7 `rounded-md`, 7 `rounded-full`; **no** hardcoded `rounded-[Npx]`). The scale edit therefore sharpens all 39 non-circular surfaces; the 7 `rounded-full` (avatars, badges, status dots) are unaffected and stay circular.
- **AC #3/#4** (primitives crisp, no behaviour/layout regression) → zero component edits; `Button`/`Card`/`Input`/`Modal`/`Badge`/KPI tiles inherit the new radius via tokens. Solid-blue primary / outline-secondary and KPI metric-with-delta were already correct (unchanged).
- **AC #5** (gate + visual) → `pnpm verify:story:web` **exit 0** (web typecheck ✓, web tests ✓ zero skips, Next/Tailwind production build ✓ — the build is the load-bearing check that the new tokens compile). **Live visual confirmation across screens is still pending and handed to the user** — I did not claim a visual pass I couldn't cleanly guarantee (the running :3000 dev server predates this change and a Tailwind-config edit needs a server restart to reload). Recommend: restart the web dev server and eyeball `/sign-in` + `/dashboard` against `docs/screenshots/`, or run the `verify` skill.

**Guardrail tripwire (Tier 2):** `git diff --name-only` = `apps/web/tailwind.config.ts` + `_bmad-output/**` only. Zero `apps/api`/`packages/shared`/`prisma`/money/RLS/gateway touch. No monetary code.

### File List

- `apps/web/tailwind.config.ts` (modified) — `borderRadius` scale tightened (sm 3 / DEFAULT 4 / md 4 / lg 6).
- `apps/web/src/components/ui/button.tsx` (modified) — default size tightened `h-10 px-4` → `h-8 px-3.5` (40px → 32px) after user feedback that buttons read too big (iterated 40→36→32 with live screenshots); `sm`/`action` sizes unchanged. Token-level (affects every default Button app-wide).

## Change Log

- 2026-06-21: Story created (ready-for-dev), final story of Epic 11. Token-layer radius tightening (Crisp ~3px: cards/buttons 6→4px, inputs 4→3px) to close the residual softness vs the reference screenshots; everything else in the Epic 9 token system already matches. Presentational/web-only, no guardrail surface.
- 2026-06-21: Implemented via bmad-dev-story on branch `story/11-3-visual-polish` (baseline `cdb6ecb`). Single-token-scale change; `pnpm verify:story:web` exit 0. Status → review; live visual sign-off (AC #5) pending with the user.
- 2026-06-21: User visual feedback "buttons look big" → tightened the default Button size, iterated 40→36→32px (`h-8 px-3.5`) with live Chrome screenshots confirming nav/`+ Add data`/anomaly card + crisp radius render correctly. Typecheck + shell tests green.
- 2026-06-21: Visual sign-off received; user opted to merge without a formal code-review pass (diff is the Tailwind radius block + the Button size). Status → done.
