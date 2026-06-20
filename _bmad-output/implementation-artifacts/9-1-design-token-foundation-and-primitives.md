---
risk_tier: 1
baseline_commit: 3a1f22f
context:
  - _bmad-output/planning-artifacts/epics/epic-9-ui-redesign.md#Story 9.1
  - docs/design-reference.md
  - apps/web/tailwind.config.ts
  - apps/web/src/app/globals.css
  - CLAUDE.md
---

# Story 9.1: Design-token foundation & UI primitives

Status: done

<!-- Retroactive story file: 9.1 was implemented before Epic 9 was formally
opened. This records the shipped work so the ledger matches reality. Implemented
in commit 5445752 on branch feat/ui-redesign-foundation. -->

## Story

As a user,
I want a consistent visual language across the app,
so that Clarifi looks trustworthy and polished.

**Scope note:** Web-only, presentational. Establishes the design-token foundation
and restyles/adds shared UI primitives. No screen is migrated in this story
(screens follow in 9.2–9.10); existing `slate-*` usage keeps rendering until each
screen is restyled. No API, schema, or business-logic change.

## Acceptance Criteria

1. Color, type, and shape tokens exist as CSS variables in `globals.css` and are wired into `tailwind.config.ts`: cool neutral palette, royal-blue `primary` (+ hover/ink), semantic (`success`/`danger`/`warning`/`info`) and categorical (`cat-*`) hues, the UPPERCASE `label` micro-type and `kpi` type sizes, tight radii (4/6/8px), and card/modal shadows. Colors use RGB channels so Tailwind opacity modifiers work (e.g. `bg-cat-blue/10`).
2. Inter is loaded via `next/font` as `--font-sans`; the app canvas/body uses the new tokens (`bg-canvas text-text`).
3. The existing primitives (Button, Card, Input, Skeleton) are restyled to the tokens **with their public APIs unchanged**, so existing callers (only `variant="outline"` / default in use) keep working.
4. New primitives cover the reference component catalogue: `Label`, `Badge`, `StatDelta`, `KpiTile`, `Progress`, `SegmentedBar` (with exported `CATEGORY_BG` palette).
5. **Display discipline preserved:** the money-bearing primitives (`KpiTile`, `SegmentedBar`) accept pre-formatted values / a `formatValue` hook and perform no monetary arithmetic; `KpiTile` exposes a `currency` tag (never blends currencies).
6. **Quality gates:** `pnpm --filter @clarifi/web typecheck`, `pnpm --filter @clarifi/web test`, and a Tailwind compile pass.

## Tasks / Subtasks

- [x] Task 1: Tokens (AC: #1, #2)
  - [x] CSS variables (RGB channels) in `globals.css`; base layer sets canvas/text/Inter, default border color, and the `.label-micro` component class.
  - [x] `tailwind.config.ts` `theme.extend`: colors, `fontFamily.sans`, `fontSize.label`/`fontSize.kpi`, radii, shadows, ring color.
  - [x] Load Inter in `layout.tsx`; switch body to `bg-canvas text-text`.
- [x] Task 2: Restyle existing primitives (AC: #3)
  - [x] Button (solid blue primary; add `ink`/`danger`/`link` variants + `size` options incl. UPPERCASE `action`), Card (+ `CardLabel`), Input, Skeleton — tokens only, APIs unchanged.
- [x] Task 3: New primitives (AC: #4, #5)
  - [x] `label.tsx`, `badge.tsx`, `stat-delta.tsx`, `kpi-tile.tsx`, `progress.tsx`, `segmented-bar.tsx`.
- [x] Task 4: Verify (AC: #6)
  - [x] typecheck, web tests, Tailwind compile.

## Dev Notes

### Risk Tier

Tier 1. Isolated, reversible, presentational. No guardrail surface touched — no
money math (formatting is delegated to callers via `value`/`formatValue`), no RLS,
no LLM gateway, no migrations, no outbox. Guardrail tripwire: `git diff --name-only`
is confined to `apps/web/src/components/ui/*`, `apps/web/src/app/{globals.css,layout.tsx}`,
`apps/web/tailwind.config.ts`, and `docs/`.

### Source Story Context

Opens Epic 9 (UI Redesign). The design system is captured in `docs/design-reference.md`
(extracted from the reference screenshots in `docs/screenshots/`). Screens migrate in
9.2–9.10. [Source: _bmad-output/planning-artifacts/epics/epic-9-ui-redesign.md#Story 9.1]

### Architecture Guardrails

- **Money display-only:** primitives never do monetary arithmetic; callers pass
  pre-formatted values. `KpiTile.currency` keeps currencies separate. [Source: CLAUDE.md#Money & data model]
- **Don't pull Prisma into the client bundle:** primitives import nothing from the
  `@clarifi/shared` root barrel. [Source: project-context.md — Epic 3/4 learning]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.8 (claude-opus-4-8)

### Completion Notes List
- Tokens added as RGB-channel CSS variables + Tailwind `theme.extend`; Inter wired via `next/font`; body switched to `bg-canvas text-text`.
- Restyled Button/Card/Input/Skeleton to tokens with unchanged APIs (verified only `default`/`outline` variants are used in the app). Added `CardLabel`.
- Added Label, Badge, StatDelta, KpiTile, Progress, SegmentedBar (+ `CATEGORY_BG`).
- Display discipline: KpiTile/SegmentedBar take pre-formatted values / `formatValue`; no arithmetic; KpiTile has a `currency` tag.
- AC traceability: AC1/AC2 → globals.css + tailwind.config.ts + layout.tsx; AC3 → button/card/input/skeleton diffs; AC4 → six new primitive files; AC5 → KpiTile/SegmentedBar prop shapes; AC6 → gate evidence below.
- Verification evidence:
  - `pnpm --filter @clarifi/web typecheck` — passed (`tsc --noEmit`).
  - `pnpm --filter @clarifi/web test` — passed (4 files, 14 tests).
  - Tailwind compile (`npx tailwindcss -i globals.css`) — built with no errors; token classes (`bg-cat-blue`, `bg-primary/10`, `text-success`, `text-kpi`, `label-micro`, `text-danger`) emit.

### File List
- `apps/web/src/app/globals.css`
- `apps/web/src/app/layout.tsx`
- `apps/web/tailwind.config.ts`
- `apps/web/src/components/ui/button.tsx`
- `apps/web/src/components/ui/card.tsx`
- `apps/web/src/components/ui/input.tsx`
- `apps/web/src/components/ui/skeleton.tsx`
- `apps/web/src/components/ui/label.tsx`
- `apps/web/src/components/ui/badge.tsx`
- `apps/web/src/components/ui/stat-delta.tsx`
- `apps/web/src/components/ui/kpi-tile.tsx`
- `apps/web/src/components/ui/progress.tsx`
- `apps/web/src/components/ui/segmented-bar.tsx`
- `docs/design-reference.md`
- `docs/screenshots/` (10 reference images)

## Change Log

- 2026-06-19: Implemented and shipped (commit 5445752, branch feat/ui-redesign-foundation): token foundation + restyled/added primitives. Retroactive story file created when Epic 9 was formally opened; status done.
