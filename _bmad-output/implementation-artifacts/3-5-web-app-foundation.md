---
risk_tier: 2
baseline_commit: 209e43d
context:
  - _bmad-output/planning-artifacts/epics/epic-3-spending-dashboard.md#Story 3.5
  - _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md#Frontend Architecture
  - _bmad-output/planning-artifacts/architecture/project-structure-boundaries.md
  - _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md
  - apps/web/src/app/layout.tsx
  - apps/api/src/modules/auth/auth.routes.ts
  - apps/api/src/modules/auth/cookies.ts
  - CLAUDE.md
---

# Story 3.5: Web app foundation & shell

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to sign in through the web app and land in an authenticated shell,
so that I (and every later feature UI) can reach protected pages backed by a shared client foundation.

**Why now:** Stories 3.1–3.4 delivered the dashboard APIs backend-only; the web app is still just a landing page (`layout.tsx` + `page.tsx`). This story builds the one-time frontend foundation — data-fetching, API access, auth/session, charting + UI primitives — that the dashboard UI (3.6) and all later feature UIs consume. It also closes the deferred Epic-1 auth-UI gap with a minimal sign-in/out flow (full auth UX polish can come later).

## Acceptance Criteria

1. **Providers & app shell:** the root layout wraps the app in a TanStack Query provider (with a single configured `QueryClient`) and a base authenticated shell (header/nav placeholder + content area). A non-authenticated landing/sign-in remains reachable.
2. **API client:** a single typed `apiClient` (in `apps/web/src/lib/api-client.ts`) is the only place the frontend talks to the backend. It sends credentials (httpOnly cookies) on every request, sets `Content-Type` for JSON, parses the central error envelope `{ error: { code, message, details? } }` into a typed error, and never reads or stores tokens in JS (cookies are httpOnly). All API base-URL config comes from an env var (e.g. `NEXT_PUBLIC_API_URL`), no hardcoded origin.
3. **Auth flow (minimal):** a sign-in page posts to the existing `POST /auth/login`; a sign-up page posts to `POST /auth/register`; a sign-out action posts to `POST /auth/logout`. Session validity is checked via `GET /auth/me`. On success the user reaches the protected shell; on `401` they are redirected to sign-in.
4. **Protected routing:** protected routes (e.g. `/dashboard`) redirect unauthenticated users to sign-in; the redirect relies on the server (a `401` from `/auth/me` or the API), never on reading the httpOnly cookie in JS.
5. **Cookie/transport model:** the chosen web→api transport forwards the httpOnly auth cookies correctly. Default: **thin BFF Route Handlers** under `apps/web/src/app/api/*` proxy to the Express API and forward cookies (the architecture's "thin BFF" model), so the browser only ever talks same-origin and `SameSite=strict` cookies survive in production. (See open questions for the direct-cross-origin alternative acceptable in dev.)
6. **Charting + UI primitives:** a React-19-compatible chart library and the shadcn/ui + Tailwind primitive set are installed and a trivial smoke usage compiles (the real charts land in 3.6). Money is rendered only via a display-layer formatter that uses integer cents + currency (reuse/（wrap `formatCents` from `@clarifi/shared`); the frontend performs no monetary arithmetic.
7. **Loading/error conventions:** a documented, reusable pattern for TanStack Query `isPending` / `isError` states (e.g. shared `<Loading/>` and `<ErrorState/>` components), so 3.6 and later UIs don't invent ad-hoc flags.
8. **Quality gates:** `pnpm --filter @clarifi/web typecheck` and `pnpm --filter @clarifi/web build` pass. Web test infrastructure (Vitest + React Testing Library + jsdom) is set up, with at least: an `apiClient` test (credentials + error-envelope parsing, fetch mocked) and an auth-guard/redirect unit test. No real network in tests.
9. **No secrets in the client bundle; no PII logged.** Only `NEXT_PUBLIC_*` config is referenced client-side. `.env.example` documents the new web env var(s).

## Tasks / Subtasks

- [ ] Task 1: Dependencies & config (AC: #1, #6, #8, #9)
  - [ ] Add to `apps/web`: `@tanstack/react-query` (5.x), the chosen chart lib (see open questions; default Recharts — verify React 19 support), shadcn/ui deps (`class-variance-authority`, `tailwind-merge`, `clsx`, Radix primitives as needed), and dev deps `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`.
  - [ ] Add `NEXT_PUBLIC_API_URL` to `.env.example` and read it in the api-client. Keep `transpilePackages: ["@clarifi/shared"]`.
  - [ ] Add a `vitest.config.ts` (jsdom environment) and `test`/`typecheck` scripts to `apps/web/package.json`.

- [ ] Task 2: API client + error model (AC: #2, #9)
  - [ ] `apps/web/src/lib/api-client.ts`: a small typed fetch wrapper — `credentials: "include"`, JSON headers, base URL from env, and parse `{ error: { code, message, details? } }` into a typed `ApiError`. No token handling in JS.
  - [ ] `apps/web/src/lib/query-client.ts`: a configured `QueryClient` (sensible defaults; no retry on 401).

- [ ] Task 3: Providers & shell (AC: #1, #7)
  - [ ] A client `Providers` component (QueryClientProvider) wired into `app/layout.tsx`.
  - [ ] A base authenticated layout/shell (header + nav placeholder + content) under a route group (e.g. `app/(app)/layout.tsx` or `app/dashboard/layout.tsx`).
  - [ ] Shared `<Loading/>` and `<ErrorState/>` components and a documented usage pattern.

- [ ] Task 4: Auth UI + transport (AC: #3, #4, #5)
  - [ ] Sign-in and sign-up pages (`app/(auth)/sign-in`, `app/(auth)/sign-up`) using React Hook Form + Zod, posting via the api-client; a sign-out action.
  - [ ] An auth/session hook (e.g. `useSession` calling `GET /auth/me`) and a protected-route guard that redirects to sign-in on `401`.
  - [ ] Implement the default BFF Route Handlers under `app/api/*` that proxy to the Express API and forward cookies (or, if the direct-cross-origin alternative is chosen, document why and ensure CORS+credentials work). Keep the api-client pointed at the same-origin BFF.

- [ ] Task 5: Charting + UI primitive smoke (AC: #6)
  - [ ] Initialize shadcn/ui (Tailwind already present) and add the few primitives 3.6 will need (card, skeleton, etc.).
  - [ ] A trivial chart smoke (a tiny static chart component) to prove the chart lib compiles under React 19 / Next 16 — real charts are 3.6.
  - [ ] A display-layer money formatter wrapping `formatCents` from `@clarifi/shared`.

- [ ] Task 6: Tests & verification (AC: #8)
  - [ ] `api-client.test.ts` (fetch mocked): asserts `credentials: "include"`, JSON handling, and error-envelope → `ApiError` mapping.
  - [ ] An auth-guard unit test: `401`/no session → redirect to sign-in; valid session → renders children.
  - [ ] Run `pnpm --filter @clarifi/web typecheck`, `pnpm --filter @clarifi/web test`, and `pnpm --filter @clarifi/web build`. Optionally drive the app via the `run`/`verify` skills to confirm sign-in → shell manually.

## Dev Notes

### Risk Tier

Tier 2. Frontend foundation — no backend guardrail (no `_cents` math, no RLS, no migration) — but **security-sensitive**: httpOnly-cookie session handling, the web→api transport, and CORS/SameSite. Treat auth/cookie/transport correctness as the high-risk surface. Money appears only at the display layer (format, never compute).

### Source Story Context

Epic 3 (added 3.5–3.6 on 2026-06-17): 3.1–3.4 were scoped backend-only, deferring this epic's frontend deliverable (FR13–FR17 include rendering). 3.5 is the shared web foundation; 3.6 is the dashboard views. The architecture has no standalone UI epic — each feature epic owns its frontend slice, so this also seeds the foundation later epics (6 query UI, 7 consent UI) reuse. [Source: _bmad-output/planning-artifacts/epics/epic-3-spending-dashboard.md#Story 3.5; _bmad-output/planning-artifacts/architecture/project-structure-boundaries.md]

### Architecture Guardrails

- **Stack:** Next.js 16 App Router (Turbopack), React 19, TypeScript; server state = TanStack Query 5.101; client state = Zustand (one store per domain, only if needed here); forms = React Hook Form + Zod; charts = Recharts/Tremor; UI = Tailwind 3 + shadcn/ui. [Source: _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md#Frontend Architecture]
- **Boundaries:** web calls api over REST with httpOnly cookies; api is the only tier with DB creds/secrets; `apps/web` is "frontend + thin BFF route handlers." The frontend never holds DB or provider secrets. [Source: CLAUDE.md; _bmad-output/planning-artifacts/architecture/project-structure-boundaries.md]
- **Patterns:** TanStack Query keys are arrays (`['budgets', { month }]`); loading/error via query states, not ad-hoc flags; JSON camelCase; money in JSON is integer cents — format to dollars only at display. [Source: _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md]
- **Money display:** reuse `formatCents(cents, currency)` from `@clarifi/shared` (already the sanctioned cents→string boundary); never divide cents to dollars in components. [Source: packages/shared/src/money.ts]

### Existing System Notes (read before building)

- `apps/web/src/app/layout.tsx` is a server component with `<html><body>` — wrap children in a **client** `Providers` component (QueryClientProvider can't live in a server component). [Source: apps/web/src/app/layout.tsx]
- `apps/web/tsconfig.json` has `@/*` → `src/*` and `transpilePackages: ["@clarifi/shared"]` in `next.config.mjs`. [Source: apps/web/tsconfig.json, next.config.mjs]
- Auth endpoints already exist: `POST /auth/register|login|refresh|logout`, `GET /auth/me` (requireAuth), `DELETE /auth/me`. Cookies are **httpOnly, SameSite=strict, Secure in prod**; access cookie path `/`, refresh path `/auth`. [Source: apps/api/src/modules/auth/auth.routes.ts, apps/api/src/modules/auth/cookies.ts]
- **CORS:** the API already allows `WEB_ORIGIN` with `credentials: true`. Direct cross-origin works in dev (localhost is same-site across ports) but `SameSite=strict` blocks cross-site cookies in prod (Vercel↔Render) — which is why the BFF proxy is the default transport. [Source: apps/api/src/app.ts; apps/api/src/modules/auth/cookies.ts]

### Implementation Guidance

- Keep the api-client tiny and the **only** fetch surface; everything goes through TanStack Query hooks that call it.
- Don't read cookies in JS (they're httpOnly) — derive auth state from `GET /auth/me` (200 vs 401), not from cookie presence.
- For the BFF: thin Route Handlers (`app/api/[...]/route.ts`) that forward method/body and the incoming `Cookie` header to `NEXT_PUBLIC_API_URL` (server-side env, can be non-public for the BFF) and relay `Set-Cookie` back. Keep them dumb pass-throughs — no business logic.
- Scope auth UI to functional minimal (sign-in/up/out + guard); defer polish.

### Testing Standards

- Web tests run under Vitest + jsdom + React Testing Library; mock `fetch`/the api-client — no real network, no real API.
- The production `build` is a primary gate for a Next foundation (catches server/client component boundary errors). Run it.
- Manual confirmation via the `run`/`verify` skills (sign-in → reach shell) is encouraged but the automated gates are typecheck + test + build.

### Project Structure Notes

Expected additions (under `apps/web/src`): `lib/api-client.ts`, `lib/query-client.ts`, `lib/format-money.ts`, `components/providers.tsx`, `components/ui/*` (shadcn), `components/{loading,error-state}.tsx`, `app/(auth)/sign-in/`, `app/(auth)/sign-up/`, `app/(app)/layout.tsx` (or dashboard layout), `app/api/*` (BFF), `vitest.config.ts`, tests. Plus `apps/web/package.json` + `.env.example` updates. No backend/API changes, no schema change.

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-3-spending-dashboard.md#Story 3.5]
- [Source: _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md#Frontend Architecture]
- [Source: _bmad-output/planning-artifacts/architecture/project-structure-boundaries.md]
- [Source: _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md]
- [Source: apps/web/src/app/layout.tsx, apps/web/next.config.mjs, apps/web/tsconfig.json]
- [Source: apps/api/src/modules/auth/auth.routes.ts, apps/api/src/modules/auth/cookies.ts, apps/api/src/app.ts]
- [Source: packages/shared/src/money.ts]
- [Source: CLAUDE.md]

## Pre-Review Due Diligence

**Complete this self-review before marking the story for review.** This repo's code review runs three lenses — Blind Hunter (context-free bugs), Edge Case Hunter (boundaries), Acceptance Auditor (AC coverage). Pre-empt them here so review finds little:

- **AC → gate/test traceability (Acceptance Auditor):** every AC #1–#9 maps to a test or a named quality gate (typecheck/build/manual). Record the mapping in Completion Notes. The api-client (#2) and auth-guard (#3/#4) have explicit unit tests.
- **Guardrail tripwire (Tier 2, security-sensitive):** run `git diff --name-only`. Confirm: (a) no secret or token is read/stored in client JS — auth state comes from `GET /auth/me`, cookies stay httpOnly; (b) only `NEXT_PUBLIC_*` envs are referenced in client code; (c) money is formatted via the display-layer formatter (integer cents + currency), with **no** monetary arithmetic in the frontend; (d) all API access goes through the single `apiClient` (no scattered `fetch`); (e) no backend/`apps/api` or `packages/shared` or schema changes (this is web-only). If the diff touches `apps/api`, `prisma/`, or money math, stop — out of scope.
- **Edge / failure paths (Edge Case Hunter):** unauthenticated hitting a protected route → redirect to sign-in; expired/invalid session (`401` from `/auth/me`) → redirect, no infinite loop; API error envelope rendered as a friendly error state (not a crash); loading state shown while pending; sign-in failure (bad creds → `401`) surfaced; sign-out clears session and redirects; server-vs-client component boundary correct (build passes).
- **Reuse first (Blind Hunter / simplify):** reuse `formatCents` from `@clarifi/shared`, the shared error-envelope shape, RHF+Zod for forms, TanStack Query for all server state (no ad-hoc `useState` loading flags), and a single `apiClient`. Don't hand-roll a second fetch/error pattern.
- **Scope discipline:** web-only. Minimal auth UI (no polish/password-reset/etc. beyond sign-in/up/out + guard). Flag any backend change with rationale (there should be none).
- **Evidence, not claims:** paste actual results of `pnpm --filter @clarifi/web typecheck`, `test`, and `build` into Completion Notes. Note any manual run/verify done. Do not mark done on "looks complete."

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log

- 2026-06-17: Story created (ready-for-dev). Scope is the one-time web foundation — TanStack Query provider, single api-client, httpOnly-cookie auth (minimal sign-in/up/out + protected routing via a thin BFF), charting + shadcn/ui primitives, loading/error conventions, and web test infra. Web-only; no backend or schema change. Closes the deferred Epic-1 auth-UI gap minimally and seeds the foundation 3.6 + later feature UIs reuse. Not implemented.
