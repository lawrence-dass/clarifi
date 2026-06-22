---
baseline_commit: 441ed770f003a7decfdecdfbe29844800951c09c
risk_tier: 3
epic: 12
story: 12.3
context:
  prd:
    - _bmad-output/prd/11-public-demo-access.md
  epic:
    - _bmad-output/planning-artifacts/epics/epic-12-public-demo-access.md
  prev_story:
    - _bmad-output/implementation-artifacts/12-1-one-click-ephemeral-demo-session.md
    - _bmad-output/implementation-artifacts/12-2-demo-abuse-and-cost-controls.md
guardrail_surfaces:
  - RLS / withUserContext (kind-branched seeding under tenant context)
  - Prisma schema + migration (User.demoKind)
  - FDX/Plaid adapter + CSV adapter (seed one source per kind — reuse, no re-normalize)
  - sign normalization / idempotency / integer-cents (inherited via the canonical adapters)
---

# Story 12.3: Two Demo Flavors (CSV vs Plaid Open-Banking)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a prospective reviewer,
I want to choose whether I'm trying the CSV-import demo or the Plaid open-banking demo,
so that each demo tells one clear story instead of a muddled CAD/USD mix of both sources.

## Acceptance Criteria

1. **AC1 — Two demo entries, kind sent to the mint endpoint (FR-12.8).** Landing (`app/page.tsx`) and sign-in offer **two** entries — **"Demo with sample CSV"** and **"Demo with Plaid (open banking)"**. Each posts a validated `kind` (`"csv" | "plaid"`) to `POST /demo/session` (alongside 12.2's Turnstile token). A missing/invalid `kind` → **400** (no provisioning).

2. **AC2 — `demoKind` recorded (FR-12.3).** The demo user record stores `demoKind` (`csv` | `plaid`), set at provision time. Added as an additive nullable column via migration `0010` (null for real users and any pre-existing demo user).

3. **AC3 — Seed only the source matching the kind (FR-12.2).** Provisioning seeds **one** source through the canonical adapters: `csv` → the bundled **CAD** sample CSV only; `plaid` → Plaid **Sandbox** only. **No cross-source seeding within a demo** (no CAD/USD mixing). Sign normalization once at ingestion, pre-categorized, idempotency `(account_id, provider_transaction_id)` + integer-cents all hold (inherited from the reused adapters).

3. **AC4 — Kind-aware badge (FR-12.3).** `demoKind` is surfaced to the client; the app-shell badge reads **"CSV Demo"** / **"Plaid Demo"** (falls back to **"Demo"** when `isDemo` but `demoKind` is null). Real users: no badge.

4. **AC5 — CSV demo Add-data default.** In the CSV demo, the **"+ Add data"** modal defaults to the **Generic CSV** format (already the default) and makes the bundled sample importable so the visitor can exercise the import + duplicate-detection pipeline. *(See Questions for the "load sample" affordance scope.)*

5. **AC6 — 12.2 controls unchanged + green gate.** Turnstile, per-IP rate limit, per-session NL quota, and the TTL reaper apply unchanged to **both** kinds (the reaper deletes by `isDemo`+`demoExpiresAt`, independent of kind). `pnpm -r typecheck` and the story's DB-backed tests pass under `pnpm verify:story`.

## Tasks / Subtasks

- [x] **Task 1 — Schema: `User.demoKind` (AC2) [GUARDRAIL: Prisma migration]**
  - [x] Add a `DemoKind` enum (`csv`, `plaid`) and `demoKind DemoKind? @map("demo_kind")` to `User` in `schema.prisma` (additive, nullable — no change to `isDemo`/`demoExpiresAt`).
  - [x] Forward migration `0010_demo_kind` (CREATE TYPE + ADD COLUMN). `users` already has RLS; no policy change. Run `pnpm --filter @clarifi/shared db:generate`; apply to local/test DB.

- [x] **Task 2 — Provisioning branches by kind (AC2, AC3) [GUARDRAIL: RLS, sign-norm, idempotency]**
  - [x] `demo.service.ts`: `provisionDemoUser({ kind })` (required). Set `demoKind: kind` on the user. Branch seeding:
    - `kind === "csv"` → `importCsv` with the bundled CAD sample **only** (no Plaid call).
    - `kind === "plaid"` → `seedPlaidSandbox` **only** (no CSV).
  - [x] Remove the unconditional "seed both" behavior. The existing `seedPlaidSandbox` helper and `importCsv` reuse is unchanged — only the branching is new.
  - [x] **Plaid-demo-when-unavailable:** if `kind === "plaid"` and Plaid is unconfigured / the sandbox seed fails, surface a clear `serviceUnavailable("PLAID_DEMO_UNAVAILABLE", …)` (503) rather than an empty or CSV-fallback demo — the kind contract stays honest. (The `csv` demo always works — bundled.) *(Confirm in Questions.)*
  - [x] Return `demoKind` in the `ProvisionedDemoUser` result.

- [x] **Task 3 — Endpoint + controller take `kind` (AC1) [behind 12.2 middleware]**
  - [x] `demo.controller.ts`: parse `{ kind }` with Zod (`z.enum(["csv","plaid"])`), 400 on invalid. Pass to `provisionDemoUser`. Response includes `demoKind`.
  - [x] `demo.routes.ts`: unchanged middleware order (`verifyTurnstile` → `rateLimit` → controller) — `kind` is a body field; Turnstile reads its token from header/body as today.

- [x] **Task 4 — Surface `demoKind` to the client (AC4)**
  - [x] Add `demoKind: "csv" | "plaid" | null` to `auth.service.ts` `PublicUser` + each `select` that returns it (`getPublicUser`, `loginUser`, `rotateRefreshToken`, `registerUser`) and the web `PublicUser` type. Real users → null.
  - [x] `app-shell.tsx` badge: `demoKind === "csv" ? "CSV Demo" : demoKind === "plaid" ? "Plaid Demo" : "Demo"` (only when `isDemo`).

- [x] **Task 5 — Web: two demo entries (AC1)**
  - [x] `TryDemoButton` takes a `kind` prop; its label + posted body reflect it; keep the 12.2 Turnstile token wiring. Render **two** buttons on landing + sign-in: "Demo with sample CSV" (`csv`) and "Demo with Plaid (open banking)" (`plaid`).

- [x] **Task 6 — CSV demo Add-data default (AC5)**
  - [x] Confirm `upload-panel.tsx` defaults `bankFormat` to `generic` (it does). For a CSV demo, optionally add a one-click "Load Clarifi sample statement" affordance importing a bundled sample. *(Scope per Questions.)*

- [x] **Task 7 — Update existing demo tests + add kind tests (AC1–AC6)**
  - [x] Update `demo.service.test.ts` / `demo.routes.test.ts` (12.1) — `provisionDemoUser` now **requires `kind`**; existing calls must pass one. Add: csv-kind seeds csv-only (no plaid accounts) + `demoKind="csv"`; plaid-kind seeds plaid-only (no csv) + `demoKind="plaid"`; route 400 on missing/invalid kind; `/auth/me` returns `demoKind`; reaper still deletes both kinds (extend `demo-reaper.test.ts` with a kind set).

## Dev Notes

### Reuse / preserve (from 12.1 & 12.2)

- **`demo.service.ts`** already has `provisionDemoUser` (base-client pre-auth user create — the sanctioned exception), `importCsv` reuse, and the `seedPlaidSandbox(userId, adapter)` helper. This story only **branches** which one runs and adds `demoKind`. Do not change the seeding internals or re-normalize signs/money.
- **`demoExpiresAt`** (0009) + the **reaper** (`queues/demo-reaper.ts`) are kind-agnostic — they key on `isDemo`+`demoExpiresAt`. Leave them as-is; just confirm both kinds get reaped (test).
- **12.2 middleware** (`verifyTurnstile`, `rateLimit`, `demoNLGuard`, quota) is unchanged — `kind` rides in the mint body; the NL guard keys off `req.isDemo` (kind-independent).
- **`PublicUser` pattern**: 12.1 added `isDemo` to the same selects — mirror exactly for `demoKind`.
- **Upload panel** already defaults to Generic CSV (`upload-panel.tsx:19`).

### Guardrails (Tier 3)

- **RLS:** seeding runs under `withUserContext(demoUserId)`; user row via base client (pre-auth exception only). Unchanged from 12.1.
- **Migration:** additive nullable column + new enum; no backfill needed.
- **Money/sign/idempotency:** inherited from `importCsv` / `seedPlaidSandbox` — the service maps nothing itself.
- **LLM egress:** untouched (categorization still via the existing outbox/gateway).
- **No change** to `withUserContext`, `lib/llm-gateway`, `lib/anonymize`, or 12.2's controls.

### Files to TOUCH

- `packages/shared/prisma/schema.prisma` (+`DemoKind`, `User.demoKind`) + `prisma/migrations/0010_demo_kind/`
- `apps/api/src/modules/demo/demo.service.ts` (kind branch + demoKind), `demo.controller.ts` (kind param)
- `apps/api/src/modules/auth/auth.service.ts` (`demoKind` in PublicUser selects)
- `apps/web/src/features/demo/try-demo-button.tsx` (kind prop), `apps/web/src/app/page.tsx`, `app/(auth)/sign-in/page.tsx` (two buttons), `apps/web/src/components/app-shell.tsx` (badge), `apps/web/src/lib/auth.ts` (`demoKind` type)
- `apps/web/src/features/upload/upload-panel.tsx` (CSV-demo affordance — per Questions)
- Tests: `demo.service.test.ts`, `demo.routes.test.ts`, `demo-reaper.test.ts`

### Verify gate

`pnpm verify:story` (DB-backed — migration + provisioning/reaper DB tests). Against the isolated local Postgres (apply `0010` there first).

### References

- [Source: _bmad-output/prd/11-public-demo-access.md] §11.1 + FR-12.2/12.3/12.8 (two-demo model)
- [Source: _bmad-output/planning-artifacts/epics/epic-12-public-demo-access.md] Story 12.3 ACs
- [Source: apps/api/src/modules/demo/demo.service.ts] `provisionDemoUser` + `seedPlaidSandbox` (12.1)
- [Source: apps/api/src/modules/auth/auth.service.ts] `isDemo`-in-PublicUser pattern to mirror
- [Source: apps/web/src/components/app-shell.tsx] Demo badge (12.1)
- [Source: apps/web/src/features/upload/upload-panel.tsx] Generic-CSV default

## Pre-Review Due Diligence

Complete BEFORE handoff; record evidence in the Dev Agent Record.

**1. AC → test traceability:**
- AC1 → route test: `{kind:"csv"}`→201 `demoKind:"csv"`; `{kind:"plaid"}`→201 `demoKind:"plaid"`; missing/invalid kind→400.
- AC2/AC3 → service test: csv-kind → `provider:csv` accounts present, **zero** `provider:plaid`; plaid-kind → plaid present, **zero** csv; `demoKind` column set accordingly; money signs still correct on the csv seed.
- AC4 → `/auth/me` returns `demoKind`; non-demo user → null.
- AC6 → `demo-reaper.test.ts`: an expired demo user of **each** kind is reaped (cascade); 12.2 middleware tests still green.
- Plaid-unavailable → plaid-kind with Plaid unconfigured → 503 `PLAID_DEMO_UNAVAILABLE` (per the confirmed decision), never a 500 or a silent CSV fallback.

**2. Guardrail tripwire** (`git diff --name-only`): expect `schema.prisma` + `0010_demo_kind`, `demo.service.ts`/`demo.controller.ts`, `auth.service.ts` (additive select). Confirm **no** change to `withUserContext`, `seedPlaidSandbox`/`importCsv` internals, `lib/llm-gateway`, 12.2 middleware logic, or money/idempotency. Flag anything else.

**3. Edge / failure paths:** missing/invalid kind (400); plaid demo when Plaid unconfigured (503, not empty/500); pre-existing demo users with null `demoKind` (badge falls back to "Demo"); both kinds reaped; idempotent re-seed on the chosen source only.

**4. Reuse first:** branch on top of `provisionDemoUser` + `seedPlaidSandbox` + `importCsv`; mirror the `isDemo`→PublicUser select pattern for `demoKind`; reuse the existing badge + upload panel. No second provisioning path, no new Plaid client, no re-normalization.

**5. Scope discipline:** only the listed files. Do not alter 12.2's middleware behavior or the reaper logic. No new dependency.

**6. Evidence:** `pnpm -r typecheck` + `pnpm verify:story` (DB-backed, isolated local Postgres); paste real pass counts + migration-applied confirmation.

## Questions (resolve at dev start)

1. **Plaid demo when Plaid is unconfigured/fails** → return **503 `PLAID_DEMO_UNAVAILABLE`** (recommended, honest kind contract) vs. silently fall back to CSV vs. provision an empty demo. *(Spec'd as 503.)*
2. **CSV-demo "Load sample statement" affordance** → just keep Generic CSV as the default (already true) **or** add a one-click button that imports a bundled sample (needs a web-side sample copy or a small `GET /demo/sample` endpoint). *(Spec'd as: default only; add the button only if you want it.)*

## Dev Agent Record

### Agent Model Used

Claude Opus 4.8 (claude-opus-4-8) — solo BMAD dev cycle.

### Debug Log References

- `pnpm --filter @clarifi/shared db:generate` → client regenerated with `DemoKind` + `User.demoKind`.
- `pnpm -r typecheck` → **PASS** (shared, api, web). Added `DemoKind` to the shared barrel re-exports.
- Web tests **35/35**; web build **PASS**.
- 12.3 demo tests in isolation: `demo.service.test.ts` **8**, `demo.routes.test.ts` **4**, `demo-reaper.test.ts` **2** — all pass.
- `pnpm verify:story` (isolated local Postgres, `0010` applied) → **395 passed, 1 failed, 0 skipped**. The one failure is the **same pre-existing** `auth.routes.test.ts` concurrent-refresh test (see `deferred-work.md`) — my only auth change is additive `demoKind` in `auth.service.ts` selects; `rotateRefreshToken` and `auth.routes.test.ts` have empty diffs vs main.

### Completion Notes List

Implementation complete; self-reviewed (3 lenses). The single demo is now **two kind-branched flavors**.

**Design applied (confirmed defaults):** Plaid demo when Plaid unavailable → **503 `PLAID_DEMO_UNAVAILABLE`** (the just-created empty user is deleted first — no orphan; CSV demo always works). CSV demo Add-data keeps **Generic CSV** as the default (already the case — no extra button).

**AC → test traceability**
- AC1 (two entries, kind→400) → `demo.routes.test.ts`: `{kind:"csv"}`→201 `demoKind:"csv"`; missing/invalid kind→400 `INVALID_DEMO_KIND`. Web: two `TryDemoButton kind=…` on landing + sign-in.
- AC2 (`demoKind` recorded) → `demo.service.test.ts`: user row has `demoKind`; migration `0010_demo_kind` (enum + nullable column).
- AC3 (single-source seeding) → `demo.service.test.ts`: csv-kind → 1 csv account, **0 plaid**; plaid-kind → plaid present, **0 csv**; money signs still correct on csv; RLS isolation intact.
- AC4 (kind badge) → `/auth/me` returns `demoKind` (csv) / `null` (real user); `app-shell.tsx` renders "CSV Demo" / "Plaid Demo" / "Demo" fallback.
- AC6 (12.2 controls + reaper both kinds) → `demo-reaper.test.ts`: expired **csv AND plaid** demo users reaped via cascade; live demo + real user untouched.
- Plaid-unavailable → `demo.service.test.ts`: plaid-kind with failing seed → rejects 503, demo-user count unchanged (orphan deleted).

**Guardrail tripwire** (`git diff --name-only` vs main): `schema.prisma` + `0010_demo_kind` (additive enum/column), `demo.service.ts`/`demo.controller.ts` (kind branch), `auth.service.ts` (additive select), shared `index.ts` (DemoKind export), web (two buttons + badge + type). **No** change to `withUserContext`, `seedPlaidSandbox`/`importCsv` internals, `lib/llm-gateway`, 12.2 middleware, the reaper logic, or money/idempotency. No new dependency.

### File List

**New**
- `packages/shared/prisma/migrations/0010_demo_kind/migration.sql`

**Modified**
- `packages/shared/prisma/schema.prisma` (`DemoKind` enum + `User.demoKind`), `packages/shared/src/index.ts` (export `DemoKind`)
- `apps/api/src/modules/demo/demo.service.ts` (kind branch + `demoKind`; Plaid-only 503 path), `demo.controller.ts` (`kind` Zod parse)
- `apps/api/src/modules/auth/auth.service.ts` (`demoKind` in PublicUser + selects)
- `apps/web/src/features/demo/try-demo-button.tsx` (`kind` prop + label/body), `app/page.tsx`, `app/(auth)/sign-in/page.tsx` (two entries), `components/app-shell.tsx` (kind badge), `lib/auth.ts` (`DemoKind` + `demoKind`)
- Tests: `demo.service.test.ts`, `demo.routes.test.ts`, `demo-reaper.test.ts` (kind-aware)
- Planning: `prd/11-public-demo-access.md` (+FR-12.8 two-demo model), `planning-artifacts/epics/epic-12-public-demo-access.md` (Story 12.3)

### Change Log

- 2026-06-22 — Implemented Story 12.3 (two demo flavors). `demoKind` enum/column (migration 0010); `/demo/session` takes `kind`; seeds one source per kind; kind badge; two landing/sign-in entries; Plaid-unavailable → 503. Typecheck + web + demo tests green; `verify:story` 395 passed / 0 skipped (1 pre-existing unrelated failure).
