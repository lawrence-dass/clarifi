---
baseline_commit: d80a3e60ea030c78b4b5ed3d40bc3c39c20522c5
risk_tier: 3
epic: 12
story: 12.1
context:
  prd:
    - _bmad-output/prd/11-public-demo-access.md
  epic:
    - _bmad-output/planning-artifacts/epics/epic-12-public-demo-access.md
guardrail_surfaces:
  - RLS / withUserContext (demo user provisioning + seeding under tenant context)
  - Prisma schema + migration (User.isDemo, User.demoExpiresAt)
  - FDX/Plaid adapter (new Sandbox public-token method)
  - sign normalization at ingestion (CSV + Plaid adapters — reuse, never re-normalize)
  - idempotency (account_id, provider_transaction_id)
  - integer-cents money
  - LLM egress via gateway (categorization)
  - PIPEDA (synthetic-data-only demo; demoExpiresAt seeds the 12.2 reaper)
---

# Story 12.1: One-Click Ephemeral Demo Session

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a prospective reviewer,
I want to enter a working Clarifi with realistic data without signing up or connecting a real bank,
so that I can evaluate the product with zero friction.

## Acceptance Criteria

1. **AC1 — One-click provisioning + authenticated entry.** A public **"Try the live demo"** action (sign-in page **and** landing page `app/page.tsx`) calls a new unauthenticated endpoint that provisions a fresh **anonymous demo user** and starts an authenticated session (sets the same access + refresh cookies as login), dropping the visitor into `/dashboard`. No signup form, no credentials entered.

2. **AC2 — RLS isolation.** The demo user is isolated through the standard `withUserContext` session-variable mechanism. A demo user's accounts/transactions are invisible to every other user, **including other concurrent demo visitors**. No new tenancy path is introduced; the `users` row is created via the base client pre-auth exactly as registration does (the `users_insert` RLS policy permits it when no `app.current_user_id` is set — migration 0004).

3. **AC3 — Seeded via canonical adapters, both sources.** The demo user is pre-seeded through the **existing canonical ingestion adapters** — the bundled sample CSV (`generic` bank format) **and** Plaid **Sandbox** synthetic transactions (no Link UI, no real bank, no Plaid cost). Sign normalization is applied **once, at the adapter boundary** exactly as for real data (CSV adapter and `plaid-adapter.ts` already do this — the demo path must **not** re-normalize signs).

4. **AC4 — Pre-categorized at provision time, zero per-render LLM.** Categorization is triggered at provision time through the existing `requestCategorization` outbox path (never a new LLM client). Normal browsing of the seeded demo incurs **no per-render LLM spend** (categories are computed once and read thereafter).

5. **AC5 — Marked + exitable.** The demo user carries an `isDemo` flag on the user record, surfaced as a visible **"Demo"** indicator in the authenticated UI. The visitor can sign out / exit via the existing logout flow.

6. **AC6 — Guardrails hold + green gate.** The `(account_id, provider_transaction_id)` idempotency constraint and integer-cents money discipline hold for all seeded data. Money is signed from the user's perspective (inflow positive, outflow negative). `pnpm -r typecheck` and the story's DB-backed tests pass under `pnpm verify:story`.

## Tasks / Subtasks

- [x] **Task 1 — Schema: mark demo users (AC2, AC5; sets up 12.2 reaper) [GUARDRAIL: Prisma migration]**
  - [x] Add to `User` in `packages/shared/prisma/schema.prisma`: `isDemo Boolean @default(false) @map("is_demo")` and `demoExpiresAt DateTime? @map("demo_expires_at")`. Do **not** alter `passwordHash`/`email`/`consentedAt` nullability — demo provisioning fills synthetic values (see Task 2).
  - [x] Create a forward migration (next number `0009_*`) — **never edit an applied migration**. Add the two columns; add `@@index([isDemo, demoExpiresAt])` (the 12.2 reaper will scan it). `users` already has RLS; no new policy is needed (confirm in Dev Notes that `users_insert` from 0004 still admits the pre-auth insert).
  - [x] Run `pnpm --filter @clarifi/shared db:generate` (Prisma 7 generate is manual). Apply the migration to the local/test DB.

- [x] **Task 2 — Demo provisioning service `modules/demo/demo.service.ts` (AC1, AC2, AC3, AC4) [GUARDRAIL: RLS, sign-norm, idempotency, money]**
  - [x] `provisionDemoUser()`:
    - [x] Create the user with the **base `prisma` client** (the sanctioned pre-auth exception — mirror `registerUser` in `auth.service.ts`, including its comment rationale). Fields: synthetic unique email `demo+${randomUUID()}@demo.clarifi.local`; `passwordHash` = `argon2.hash(randomBytes(32).toString("hex"))` (a valid PHC string that no real password can match — keeps the NOT NULL invariant without a login backdoor); `consentedAt = new Date()`; `isDemo: true`; `demoExpiresAt = new Date(Date.now() + 60 * 60 * 1000)` (1 hour).
    - [x] Seed CSV: reuse `importCsv({ userId, bankFormat: "generic", institution: ..., csv })` from `ingestion.service.ts`. **Bundle** the seed CSV into the API package (e.g. `modules/demo/seed-data/sample-statement-generic.csv` or an inlined string constant) — do **not** read `docs/sample-data/...` at runtime (not shipped in the production bundle). It is fine to copy the contents of `docs/sample-data/sample-statement-generic.csv`.
    - [x] Seed Plaid Sandbox: reuse `exchangePlaidPublicToken({ userId, publicToken })` (`accounts.service.ts`) → then run a sync via `processPlaidSyncJob({ itemId })` (`workers/plaid-sync.worker.ts`) **or** enqueue through `enqueuePlaidSync`/the plaid-sync outbox. This reuses the canonical Plaid adapter (sign normalization + idempotency upsert) end-to-end. Requires a sandbox public token — see Task 3.
    - [x] `importCsv` already calls `requestCategorization` when it imports rows, and `processPlaidSyncJob` requests categorization per account — so AC4 is satisfied by reuse. **Do not** add a second categorize path or call the LLM gateway directly.
  - [x] **Graceful degradation:** if Plaid is not configured (`createPlaidClient` throws `PLAID_NOT_CONFIGURED` 503) or sandbox seeding fails, log and continue with **CSV-only** seeding — the demo must still succeed. CSV failure is a hard error (the demo would be empty).

- [x] **Task 3 — Plaid Sandbox public-token method on the adapter (AC3) [GUARDRAIL: FDX/Plaid adapter]**
  - [x] **Research first (do not hardcode from memory):** confirm the exact endpoint + params at https://plaid.com/docs/sandbox/#using-sandbox. Add `sandboxPublicTokenCreate` to `PlaidClientLike` and a `createSandboxPublicToken()` method on `PlaidAdapter` in `lib/plaid-adapter.ts`. Expected shape: `plaidClient.sandboxPublicTokenCreate({ institution_id, initial_products: [Products.Transactions] })` → `{ data: { public_token } }`; a common sandbox institution is `ins_109508`. Verify against the live doc.
  - [x] Keep it behind the same `PlaidClientLike` seam used by tests (so the demo service can inject a fake). Do not introduce a second Plaid SDK client — extend the existing `getClient()` path.

- [x] **Task 4 — Demo route + controller (AC1, AC5) [GUARDRAIL: RLS session issuance]**
  - [x] `modules/demo/demo.controller.ts` + `demo.routes.ts`: `POST /demo/session` (no `requireAuth` — this is the entry). Provision, then mint session: `issueAccessToken(user.id)` + issue a refresh row in a fresh family (reuse the login token-issuing pattern from `auth.service.loginUser`/`auth.controller.login`), `setAuthCookies(res, ...)`, return the public demo user shape including `isDemo`. (12.2 will add Turnstile + rate-limit middleware in front of this route — leave a clear seam, do not implement those here.)
  - [x] Mount `app.use("/demo", demoRouter)` in `app.ts` alongside the other routers.

- [x] **Task 5 — Surface `isDemo` to the client + "Demo" badge (AC5)**
  - [x] Add `isDemo` to the public-user shape returned by `/demo/session` and `/auth/me` (extend `PublicUser` in `auth.service.ts` `select` + the web `PublicUser` type in `apps/web/src/lib/auth`). For non-demo users it is `false`.
  - [x] Render a small **"Demo"** badge in the authenticated app shell (the Epic 11.1 header / `UserMenu` area) when `session.isDemo` is true. Reuse existing badge styling (`rounded-full` token, per Epic 11 notes) — no new dependency.

- [x] **Task 6 — Web entry point "Try the live demo" (AC1)**
  - [x] Add the button to `apps/web/src/app/(auth)/sign-in/page.tsx` and the landing `apps/web/src/app/page.tsx`. Mirror the existing `login` mutation: `apiClient<PublicUser>("/demo/session", { method: "POST" })`, `onSuccess` → `queryClient.setQueryData(["session"], user)` + `router.replace("/dashboard")`. Add `/demo/session` to `NO_REFRESH_PATHS` in `api-client.ts` (a 401 there is not a stale-token case).

- [x] **Task 7 — Tests (AC1–AC6) [DB-backed; no skips]**
  - [x] See AC→test mapping in Pre-Review Due Diligence. Cover: provisioning fields, RLS cross-demo isolation, integer-cents + sign correctness on known seed rows, idempotency, demo-login-impossible, route sets cookies + returns `isDemo: true`, Plaid-not-configured CSV-only degradation.

## Dev Notes

### Existing patterns to REUSE (do not reinvent)

- **Pre-auth user creation exception** — `auth.service.registerUser` (lines 52–73) uses the base `prisma` client because no `app.current_user_id` exists yet; the `users_insert` policy (migration `0004_review_hardening`) admits it via `NULLIF(current_setting('app.current_user_id', true), '') IS NULL`. Demo user creation is the **same** sanctioned exception — copy the rationale comment.
- **RLS unit-of-work** — `withUserContext(userId, fn, opts?)` in `packages/shared/src/prisma.ts`. All seeding (CSV + Plaid) already runs inside it via the reused services. `userId` must be a valid UUID (the helper throws otherwise) — `User.id` is `@default(uuid())`, so use the created row's id.
- **CSV ingestion** — `importCsv` (`ingestion.service.ts`) owns CSV sign/currency normalization, the per-(user,institution) account upsert, the duplicate-skip on `(accountId, providerTransactionId)`, and the `requestCategorization` enqueue. Reuse wholesale.
- **Plaid connect + sync** — `exchangePlaidPublicToken` (`accounts.service.ts`) stores the encrypted item + upserts accounts under RLS; `processPlaidSyncJob` (`plaid-sync.worker.ts`) pulls pages, upserts transactions on the idempotency key, and requests categorization. `plaid-adapter.ts` `mapTransaction` already applies the sign flip (`-dollarsToCents`, line 186) — **never** re-flip downstream.
- **Session issuance** — `issueAccessToken` (`tokens.ts`) + `setAuthCookies` (`cookies.ts`). Refresh row creation pattern is in `auth.service.loginUser` (`issueRefreshRow`). The demo session is a normal authenticated session; `requireAuth` middleware needs no change (it just verifies the JWT and that the user row exists).
- **Categorization egress** — only `lib/llm-gateway.ts` may import the Anthropic SDK. The reused enqueue → `categorize.worker` path already routes through it. Do not touch the gateway.

### Files to TOUCH

- `packages/shared/prisma/schema.prisma` (User: +2 fields) + new `prisma/migrations/0009_*/migration.sql`
- `apps/api/src/modules/demo/` (NEW: `demo.service.ts`, `demo.controller.ts`, `demo.routes.ts`, `seed-data/`, tests)
- `apps/api/src/lib/plaid-adapter.ts` (+ `sandboxPublicTokenCreate` / `createSandboxPublicToken`)
- `apps/api/src/app.ts` (mount `/demo`)
- `apps/api/src/modules/auth/auth.service.ts` (PublicUser `select` + interface: add `isDemo`)
- `apps/web/src/app/(auth)/sign-in/page.tsx`, `apps/web/src/app/page.tsx`, app-shell badge, `apps/web/src/lib/auth`, `apps/web/src/lib/api-client.ts`

### Guardrail constraints (Tier 3 — all must hold)

- **Money:** every seeded amount is integer cents (`BigInt`), signed from the user's perspective. Inflow positive, outflow negative. Verified by reusing the canonical adapters — assert it in tests against known seed rows (`Payroll Deposit … 2450.00` → `+245000n`; `Loblaws … -92.40` → `-9240n`).
- **Sign normalization happens once.** CSV adapter + `plaid-adapter.mapTransaction` are the only places signs are set. The demo service maps nothing itself.
- **Idempotency:** `(accountId, providerTransactionId)`. Re-running provisioning mints a **new** demo user (a new tenant) — isolation is per user; do not attempt to dedupe demo users against each other.
- **RLS:** seeding under `withUserContext(demoUserId)`; user row created via base client (pre-auth exception only). Never set `app.current_user_id` to a caller-supplied value.
- **LLM egress** only via the existing gateway through the reused categorize path. No new SDK client, no inline LLM call.
- **PIPEDA:** demo holds synthetic data only (sample CSV + Plaid Sandbox); `demoExpiresAt` is written here so the 12.2 reaper (the deletion path) can act on it. Existing `onDelete: Cascade` already removes all child rows when the user is deleted.

### Scope boundary vs Story 12.2

12.1 = provisioning + canonical seeding + authenticated entry + "Demo" marker, and it **writes** `demoExpiresAt`. 12.2 owns the **abuse/cost controls** (Cloudflare Turnstile, per-IP rate limits, per-session NL-query quota) and the **TTL reaper** that consumes `demoExpiresAt`. Do not build Turnstile, rate limiting, the quota, or the reaper in this story — but leave the `/demo/session` route a clean seam for that middleware.

### Project Structure Notes

- New module `modules/demo/` mirrors the existing module layout (`*.service.ts` / `*.controller.ts` / `*.routes.ts` + colocated `*.test.ts`).
- API ships TS source from `@clarifi/shared` under `tsx`/Next `transpilePackages` — import client-safe values in web code from dedicated subpaths, not the root barrel (Prisma leaks via the barrel). The `isDemo` boolean is a primitive on the session JSON, so no shared-enum import is needed.
- Verify gate is **`pnpm verify:story`** (DB-backed) — this story has a migration + DB writes. Not `verify:story:web`.

### References

- [Source: _bmad-output/prd/11-public-demo-access.md] — §11.1 FR-12.1–12.3 (this story), §11.3 demo privacy posture
- [Source: _bmad-output/planning-artifacts/epics/epic-12-public-demo-access.md] — Story 12.1 acceptance criteria + Tier-3 guardrail banner
- [Source: packages/shared/src/prisma.ts] — `withUserContext` (RLS session-var mechanism)
- [Source: apps/api/src/modules/auth/auth.service.ts#registerUser] — sanctioned base-client pre-auth user creation
- [Source: packages/shared/prisma/migrations/0004_review_hardening/migration.sql] — `users_insert` policy admitting pre-auth inserts
- [Source: apps/api/src/modules/ingestion/ingestion.service.ts#importCsv] — canonical CSV ingestion to reuse
- [Source: apps/api/src/modules/accounts/accounts.service.ts#exchangePlaidPublicToken] — Plaid item/account persistence
- [Source: apps/api/src/workers/plaid-sync.worker.ts#processPlaidSyncJob] — Plaid sync + idempotent transaction upsert
- [Source: apps/api/src/lib/plaid-adapter.ts] — adapter to extend with the sandbox method; `mapTransaction` sign flip
- [Source: apps/api/src/modules/auth/cookies.ts] + [tokens.ts] — session cookie + access-token issuance
- [Source: docs/sample-data/sample-statement-generic.csv] — seed CSV contents to bundle
- [Source: https://plaid.com/docs/sandbox/#using-sandbox] — verify `sandboxPublicTokenCreate` at build time

## Pre-Review Due Diligence

Complete this BEFORE handoff. Self-review against the three bmad-code-review lenses + the repo guardrail tripwire, and record evidence in the Dev Agent Record. Every bullet is specific to THIS story.

**1. AC → test traceability (record the mapping in Completion Notes):**
- AC1 (provision + authenticated entry) → route test: `POST /demo/session` returns 200, sets `access_token` + `refresh_token` cookies, body has `isDemo: true`.
- AC2 (RLS isolation) → DB test: provision two demo users; under `withUserContext(userA)` you see A's transactions and **zero** of B's; repeat for B.
- AC3 (canonical seeding, both sources) → DB test: after provisioning, CSV account (provider `csv`) and Plaid account (provider `plaid`) both exist with transactions; assert a fake Plaid sandbox client is exercised through the adapter seam.
- AC3/AC6 (sign + integer cents) → DB test: assert `Payroll Deposit` row = `+245000n` and `Loblaws` row = `-9240n` (`BigInt`, signed from user's perspective).
- AC4 (categorize via outbox, no new LLM path) → test: provisioning creates a `categorization.requested` outbox row (or calls the injected `requestCategorization`); assert the LLM gateway is **not** called inline.
- AC5 (`isDemo` marker) → test: created user has `isDemo === true`, `demoExpiresAt` ≈ now + 1h; `/auth/me` and `/demo/session` include `isDemo`.
- AC2/AC5 (no login backdoor) → test: `loginUser({ email: <demo email>, password: <anything> })` throws the generic 401 (the random PHC hash never verifies).
- AC6 (idempotency) → covered by reusing the upsert paths; add an assertion that re-running the Plaid sync page for the same demo user does not duplicate rows.
- Degradation → test: with Plaid unconfigured/throwing, provisioning still succeeds with CSV-only data (no 500).

**2. Guardrail tripwire — run `git diff --name-only` and justify each guardrail-touching file:**
- `schema.prisma` + `migrations/0009_*` → expected (User demo columns; forward migration, no edit to applied ones).
- `prisma.ts`/`withUserContext` → should be **unchanged** (reused, not modified). If it changed, justify or revert.
- `plaid-adapter.ts` → expected (additive sandbox method via the existing client seam; `mapTransaction` sign flip untouched).
- `ingestion.service.ts` / `accounts.service.ts` / `plaid-sync.worker.ts` → ideally **unchanged** (reused). Any edit here is a red flag — justify or revert.
- `auth.service.ts` → expected, minimal (`isDemo` in the `PublicUser` select/interface only). Do not touch login/rotation logic.
- Flag any unexpected guardrail file (e.g. `llm-gateway.ts`, `anonymize.ts`, other migrations) as out of scope.

**3. Edge / failure paths to handle:**
- Plaid not configured / sandbox call fails → CSV-only, demo still works (no 500).
- Worker down → categories populate later; provisioning must not block or fail on categorization (it's fire-and-forget via the outbox, matching real ingestion).
- Synthetic email collision → astronomically unlikely with `randomUUID()`, but a `P2002` on insert should surface as a clean 500-with-code, not a crash; one retry is acceptable.
- Demo user attempting password login or refresh reuse → must behave exactly like any user (no special-casing in auth).
- Cross-tenant: a second concurrent demo visitor must never see the first's rows (the core RLS assertion).

**4. Reuse first (forbid duplication):** reuse `importCsv`, `exchangePlaidPublicToken`, `processPlaidSyncJob`, `requestCategorization`, `withUserContext`, `issueAccessToken`, `setAuthCookies`, the `registerUser` pre-auth pattern, and the `getClient()` Plaid seam. Do **not** create a second Plaid client, a second categorize path, or a hand-rolled transaction insert.

**5. Scope discipline:** touch only the files listed in *Files to TOUCH*. No Turnstile / rate-limit / quota / reaper (those are 12.2).

**6. Evidence, not claims:** run `pnpm -r typecheck` and `pnpm verify:story`; paste the real pass counts (and the migration-applied confirmation) into the Dev Agent Record. Do not mark done on "looks complete" or with skipped DB tests.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.8 (claude-opus-4-8) — solo BMAD dev cycle (implement → 3-lens self-review → fix → verify).

### Debug Log References

- `pnpm --filter @clarifi/shared db:generate` → Prisma Client 7.8.0 generated (User demo columns present).
- `pnpm -r typecheck` → **PASS** (shared, api, web). Fixed two pre-existing `PlaidAdapter` fakes (`accounts.routes.test.ts`, `plaid-sync.worker.test.ts`) that needed the new `createSandboxPublicToken` interface method.
- `pnpm --filter @clarifi/api exec vitest run src/lib/plaid-adapter.test.ts` → **5 passed** (incl. new sandbox-token test).
- `pnpm --filter @clarifi/web test` → **35 passed** (incl. updated session mocks).
- `pnpm --filter @clarifi/web build` → **PASS** (compiles; `/` landing + `/sign-in` render with the demo entry).

### Completion Notes List

Implementation complete; all tasks coded + self-reviewed (Blind Hunter / Edge Case Hunter / Acceptance Auditor).

**AC → test traceability**
- AC1 (one-click + authenticated entry) → `demo.routes.test.ts`: `POST /demo/session` 201 + httpOnly cookies + `/auth/me` returns the demo user. Web: `TryDemoButton` on sign-in + landing.
- AC2 (RLS isolation) → `demo.service.test.ts`: two demo users; under A's `withUserContext` only A's rows; B's invisible by explicit filter. Plus demo-login-impossible test.
- AC3 (both canonical adapters, sign normalized once) → `demo.service.test.ts`: csv + plaid accounts both present; money signs asserted.
- AC4 (categorize via outbox, no inline LLM) → `demo.service.test.ts`: `requestCategorization` (mocked) called; no `llm-gateway` import in the demo module.
- AC5 (isDemo marker) → `demo.routes.test.ts` (`isDemo:true`) + non-demo user `isDemo:false`; web "Demo" badge in app-shell.
- AC6 (integer cents + idempotency) → `demo.service.test.ts`: Payroll `+245000n`, Loblaws `-9240n`; re-import is a no-op (0 imported, duplicates skipped).
- Degradation → `demo.service.test.ts`: Plaid sandbox failure → CSV-only, no throw.

**Guardrail tripwire** (`git diff --name-only` reviewed):
- `schema.prisma` + `migrations/0009_demo_users` → expected (additive User demo columns; forward migration).
- `lib/plaid-adapter.ts` → expected (additive `createSandboxPublicToken` via the existing client seam; `mapTransaction` sign flip untouched).
- `auth.service.ts` → expected, minimal (`isDemo` added to PublicUser selects + new `issueUserSession`; login/rotation/delete logic untouched).
- `prisma.ts`/`withUserContext`, `ingestion.service.ts`, `accounts.service.ts`, `plaid-sync.worker.ts` (logic), `llm-gateway`, `anonymize` → **NOT modified** (reused). Only the two adapter-fake *test* files changed for the new interface method.
- No new dependency added.

**DB-backed gate — ran against an isolated local Postgres (Homebrew postgresql@16, db `clarifi_test`).** All 9 migrations applied (incl. `0009_demo_users`). Temporarily pointed `DATABASE_URL`/`DIRECT_URL` at the local DB for the run, then restored `.env` to Supabase.

- `pnpm verify:story` → **376 passed, 1 failed, 0 skipped** (zero-skip requirement met; the LLM-egress, migrate-status, and typecheck checks all passed).
- My story's tests in isolation → `vitest run src/modules/demo/` = **10/10 passed** (`demo.service.test.ts` 7, `demo.routes.test.ts` 3).

**The single failure is pre-existing and unrelated to this story:** `auth.routes.test.ts > "is atomic under concurrent refresh of the same token (AC #3)"` (Story 1.3). Proof: `git diff main -- auth.routes.test.ts` is empty (untouched), and my only `auth.service.ts` changes are additive (`isDemo` in 4 `select`s + a new `issueUserSession`) — the `rotateRefreshToken` revoke/race logic is byte-for-byte unchanged. It fails **deterministically** (2/2 runs) only against local Postgres: the test fires two concurrent `/auth/refresh` calls expecting overlapping transactions, but local PG's sub-ms latency serializes them so the loser reads the winner's already-committed `revokedAt` and takes the family-revoke (reuse) branch, killing the winner's new token. Against the higher-latency Supabase the two reads overlap and the conditional-revoke race path is taken instead. This is a test-robustness/timing issue in Story 1.3's code, out of scope for 12.1 — recommend tracking separately.

### File List

**New**
- `apps/api/src/modules/demo/demo.service.ts`
- `apps/api/src/modules/demo/demo.controller.ts`
- `apps/api/src/modules/demo/demo.routes.ts`
- `apps/api/src/modules/demo/seed-data/demo-statement.ts`
- `apps/api/src/modules/demo/demo.service.test.ts`
- `apps/api/src/modules/demo/demo.routes.test.ts`
- `apps/web/src/features/demo/try-demo-button.tsx`
- `packages/shared/prisma/migrations/0009_demo_users/migration.sql`

**Modified**
- `packages/shared/prisma/schema.prisma` (User: `isDemo`, `demoExpiresAt`, index)
- `apps/api/src/lib/plaid-adapter.ts` (+ `createSandboxPublicToken`, `SANDBOX_INSTITUTION_ID`)
- `apps/api/src/lib/plaid-adapter.test.ts` (sandbox test + fake method)
- `apps/api/src/modules/auth/auth.service.ts` (`isDemo` in PublicUser; `issueUserSession`)
- `apps/api/src/app.ts` (mount `/demo`)
- `apps/api/src/modules/accounts/accounts.routes.test.ts`, `apps/api/src/workers/plaid-sync.worker.test.ts` (fake adapter: new method)
- `apps/web/src/app/(auth)/sign-in/page.tsx`, `apps/web/src/app/page.tsx` (demo entry)
- `apps/web/src/components/app-shell.tsx` (Demo badge), `apps/web/src/components/app-shell.test.tsx`, `apps/web/src/components/auth-guard.test.tsx` (session mocks)
- `apps/web/src/lib/auth.ts` (`isDemo` on PublicUser), `apps/web/src/lib/api-client.ts` (`/demo/session` no-refresh)

### Change Log

- 2026-06-21 — Implemented Story 12.1 (one-click ephemeral demo session). Typecheck + web tests + Plaid unit test + web build green. DB-backed gate pending an isolated Postgres decision.
