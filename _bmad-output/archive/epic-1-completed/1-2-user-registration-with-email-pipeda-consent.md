---
baseline_commit: 210f146
context:
  - _bmad-output/planning-artifacts/epics.md#Story 1.2
  - _bmad-output/planning-artifacts/architecture.md#Authentication & Security
  - CLAUDE.md
---

# Story 1.2: User registration with email & PIPEDA consent

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a new user,
I want to register with email and password and consent to data processing,
so that I have a PIPEDA-compliant account.

## Acceptance Criteria

1. `POST /auth/register` accepts `{ email, password, consent }`. The body is validated with a **shared Zod schema** (`@clarifi/shared`); invalid bodies are rejected `400` with the `{ error: { code, message, details? } }` contract — no user row created.
2. On a valid request the password is hashed with **argon2id (timeCost=3, memoryCost=65536 KiB = 64 MiB, parallelism=1)** and a `User` row is created with `consentedAt` set to now. **Only the argon2 PHC hash is stored** — the plaintext password is never persisted or logged.
3. Registration is **rejected** when: `consent` is not exactly `true` (`400`), the password fails policy (`400`), or the email is already registered (`409`). Each rejection returns the error contract and creates no row.
4. The success response is `201` with the created user as a bare resource — `{ id, email, consentedAt }` (camelCase, ISO-8601 dates). The `passwordHash` is **never** returned.
5. A pure unit test proves the Zod schema accepts a valid body and rejects (consent=false, bad email, weak password). An integration test (gated on a live DB, like `rls.test.ts`) proves: a user is created with `consentedAt` set and a verifiable argon2id hash, a duplicate email is rejected `409`, and `consent:false` creates no row. Existing tests still pass; `pnpm -r typecheck` is clean.

## Tasks / Subtasks

- [x] Task 1: Shared registration schema (AC: #1, #3) — in `@clarifi/shared`
  - [x] Create `packages/shared/src/auth.ts` exporting `RegisterInput` (Zod): `email` (`z.string().email()`, lowercased+trimmed via `.transform`), `password` (`z.string().min(12).max(128)`), `consent` (`z.literal(true)` — anything but `true` fails). Export the inferred type `RegisterInput`.
  - [x] Re-export from `packages/shared/src/index.ts` (follow the existing `export * from "./auth.js"` pattern).
  - [x] Co-located unit test `packages/shared/src/auth.test.ts` (Vitest) — valid body passes; consent=false / bad email / 11-char password each fail. This test needs **no DB** (always runs in CI).
- [x] Task 2: Establish the API error contract (AC: #1, #3) — first story to add routes, so build the shared plumbing
  - [x] `apps/api/src/lib/app-error.ts`: `AppError extends Error` with `code: string` + `httpStatus: number` (+ optional `details`). Helpers e.g. `badRequest`, `conflict`.
  - [x] `apps/api/src/middleware/error.ts`: Express error middleware that maps `AppError` → `res.status(httpStatus).json({ error: { code, message, details } })`, maps `ZodError` → `400 { code: "VALIDATION_ERROR", details: <flattened issues> }`, and maps anything else → `500 { code: "INTERNAL" }` with a generic message (never leak internals). Register it **last** in `createApp()`.
- [x] Task 3: Auth module — register endpoint (AC: #1–#4) — `apps/api/src/modules/auth/`
  - [x] `auth.service.ts`: `registerUser(input: RegisterInput)` — hash with argon2id (params above), create the `User` via **base `prisma` client** (NOT `withUserContext` — see Dev Notes), return `{ id, email, consentedAt }`. Catch Prisma `P2002` (unique email) → throw `conflict("EMAIL_TAKEN", ...)`.
  - [x] `auth.controller.ts`: parse `req.body` with `RegisterInput` (throw on failure → caught by error mw), call the service, respond `201` with the bare resource.
  - [x] `auth.routes.ts`: `Router()` with `POST /register`; export `authRouter`.
  - [x] Mount in `apps/api/src/app.ts`: `app.use("/auth", authRouter)` (before the error middleware).
- [x] Task 4: Dependencies & verify (AC: #5)
  - [x] Add `argon2` to `apps/api/package.json` dependencies; `pnpm install`.
  - [x] `apps/api/src/modules/auth/auth.test.ts`: integration test gated with `describe.skipIf(!hasDb)` (copy the `hasDb` guard from `packages/shared/src/rls.test.ts`). Assert: register creates a user with `consentedAt` set; `argon2.verify(stored, password)` is true and the stored value is a `$argon2id$` PHC string; duplicate email → 409/`EMAIL_TAKEN`; cleanup created rows in `afterAll`.
  - [x] Run `pnpm -r typecheck` and `pnpm -r test` — all green.

### Review Findings

_Adversarial code review 2026-06-15 (Blind Hunter + Edge Case Hunter + Acceptance Auditor; auditor re-run once after a malfunction). All 5 ACs MET in code; AC#5 test-coverage gap now closed. 1 decision-needed (→ patch), 4 patch (all applied), 4 deferred, 8 dismissed. Reviewed on Opus 4.8 (same as implementer) — future reviews to run on a different model._

**Resolved decision:**

- Decision (HTTP-layer endpoint tests missing) → **Option A: add `supertest` + e2e tests** (applied — see patch below).

**Patch (all applied):**

- [x] [Review][Patch] Body-parser errors returned 500 instead of 4xx and weren't logged. APPLIED: `errorMiddleware` now honors a numeric `err.status`/`statusCode` (malformed JSON → 400 `BAD_REQUEST`, oversized → 413 `PAYLOAD_TOO_LARGE`); `pinoHttp` moved before `express.json` so `req.log` is set when parse errors throw. [apps/api/src/middleware/error.ts, apps/api/src/app.ts]
- [x] [Review][Patch] Email schema was unbounded. APPLIED: added `.max(254)` (RFC 5321). NFC normalization was found unnecessary and dropped — Zod `.email()` is ASCII-only (verified), so any accepted address is already Unicode-normalized and the NFC-vs-NFD duplicate (EC3) can't occur through this endpoint; documented in `auth.ts` + covered by a test asserting non-ASCII local parts are rejected. [packages/shared/src/auth.ts]
- [x] [Review][Patch] Error contract emitted `details: undefined`. APPLIED: middleware now omits `details` when absent; tests assert the real wire shape (no `details` key) and that present details are included. [apps/api/src/middleware/error.ts, error.test.ts]
- [x] [Review][Patch] HTTP-layer endpoint tests missing (resolved decision). APPLIED: added `supertest` (devDep) + `auth.routes.test.ts` driving the mounted app — 201 + body shape + no `passwordHash` over the wire, `consent:false`→400 + **no row** (closes AC#5), weak password→400 + no row, duplicate→409, malformed JSON→400. [apps/api/src/modules/auth/auth.routes.test.ts]

**Deferred:**

- [x] [Review][Defer] No rate limiting on `/auth/register` (enumeration amplifier + argon2 DoS surface) [apps/api/src/modules/auth/auth.routes.ts] — deferred: architecture plans `middleware/rate-limit.ts`; cross-cutting, not 1.2 scope. The 409 email-enumeration itself is an accepted, documented v1 tradeoff.
- [x] [Review][Defer] Integration tests run against the live Supabase via root `.env` (no isolated test DB) [apps/api/vitest.config.ts] — deferred: matches the established Story 1.1 pattern (`rls.test.ts`); a dedicated test DB is a repo-wide infra improvement.
- [x] [Review][Defer] No `asyncHandler` wrapper — each async route must hand-roll try/catch + `next(err)` [apps/api/src/modules/auth/auth.controller.ts] — deferred: add a shared wrapper when more routes land in Story 1.3.
- [x] [Review][Defer] Transient Prisma/pooler errors (P1017, connection lost) map to 500 rather than a retryable 503 [apps/api/src/modules/auth/auth.service.ts] — deferred: only P2002 needs handling for this story; broader DB-error taxonomy is cross-cutting.

**Dismissed (8):** untyped `app-error.ts` helpers (false positive — condensed-diff artifact; actual code typed, typecheck passes); untyped controller params (same false positive); argon2 hash before the uniqueness check (pre-checking would add a check-then-insert race — the P2002 pattern is correct); argon2 failure → 500 (correctly an internal error regardless of try placement); password `.max(128)` counting UTF-16 code units (cosmetic); non-`.strict()` schema strips unknown keys (acceptable per spec); `.npmrc`/`fileParallelism` "perf footgun" (intentional — deterministic shared-DB tests); `details: unknown` type as a latent leak (developer-controlled, no current leak).

## Dev Notes

### Reuse — do NOT recreate
- **`User` model already exists** (`packages/shared/prisma/schema.prisma:95`): `id` (uuid), `email` (`@unique`), `passwordHash` (`@map("password_hash")`), `consentedAt` (`@map("consented_at")`), timestamps. The migration is already applied. **Do not edit the schema or add a migration for this story.**
- **`prisma` base client** is exported from `@clarifi/shared` (`packages/shared/src/prisma.ts`). Import domain types/enums from `@clarifi/shared`, never from `@prisma/client` directly (Prisma 7 guardrail).
- **Zod is the boundary validator** — mirror the existing style in `packages/shared/src/nl-query-ir.ts` (schemas + inferred types, exported from `index.ts`).
- **Express app** is built in `apps/api/src/app.ts` via `createApp()`; `config.ts` already Zod-validates env at boot. Helmet/cors/cookie-parser/json/pino are already wired. You only add the `/auth` router + the error middleware.

### The RLS exception that matters for THIS story (critical)
Registration runs **before any auth context exists**, so it must use the **base `prisma` client directly — NOT `withUserContext`**:
- `withUserContext` requires a known userId (it's the RLS subject); a brand-new user doesn't have one yet, and the helper now throws on a non-UUID/empty id (from Story 1.1's review hardening).
- Story 1.1 narrowed the `users` INSERT RLS policy to allow inserts when no `app.current_user_id` is set (exactly the signup case) — see `migrations/0004_review_hardening/migration.sql`. The base client connects as the admin role and the email `@unique` constraint is the duplicate guard.
- This is **the one sanctioned exception** to "all user-data access goes through `withUserContext`". Every *other* user-data path (login lookups in 1.3 onward) still must justify its tenancy. Document this in a code comment so it isn't cargo-culted.

### Security & correctness specifics (easy to get wrong)
- **argon2id params are non-negotiable** (architecture.md:102, OWASP 2026): `{ type: argon2.argon2id, timeCost: 3, memoryCost: 65536, parallelism: 1 }`. `memoryCost` is in **KiB**, so 64 MiB = `65536`. argon2 generates its own salt and encodes all params into the stored PHC string — verification (Story 1.3) needs only that string.
- **Password length cap (max 128)** is a real control: argon2 hashing is intentionally expensive, so unbounded input is a DoS vector. Min 12 is the floor; do not lower it.
- **Never log PII** (architecture.md:175): no email, no password, no hash in logs. The pino logger is already `silent` in test.
- **Email normalization:** lowercase + trim in the Zod `.transform` so `A@x.com` and `a@x.com` collide on the unique constraint rather than creating duplicates.
- **No tokens in this story.** Issuing JWT access/refresh cookies is **Story 1.3** — registration only creates the account. Keep scope tight; don't pull login forward.

### Email enumeration tradeoff (interview-defensible decision)
AC#3 requires rejecting a duplicate email, which inherently reveals the email exists (`409 EMAIL_TAKEN`). For v1 this is an accepted UX-over-privacy tradeoff; note it in a comment. A hardened alternative (return `201` generic + send a "you already have an account" email out-of-band) is deferred — mention it as the mitigation if asked.

### API contract (architecture.md:159-164)
- Success: return the resource directly, **no wrapper**; camelCase; ISO-8601 dates; `201` for create.
- Error: `{ error: { code, message, details? } }` via the central middleware — `400 VALIDATION_ERROR`, `409 EMAIL_TAKEN`, `500 INTERNAL`.
- Layering (architecture.md:157): route → controller → service. A separate repository layer is optional here; the service may call `prisma` directly given the single insert.

### Testing standards (architecture.md:154, mirror Story 1.1)
- Vitest, co-located `*.test.ts`. Pure schema tests run always; DB-touching tests use `describe.skipIf(!hasDb)` with `hasDb = (process.env.DATABASE_URL ?? "").length > 0 && !…includes("placeholder")` (copy from `rls.test.ts`).
- `apps/api` has no `vitest.config.ts` yet — if the integration test needs the root `.env` loaded, add one mirroring `packages/shared/vitest.config.ts` (loads `../../.env`, `fileParallelism: false`).
- argon2 at 64 MiB is slow (~50–100ms/hash); keep the number of real hashes in tests small.

### Project Structure Notes
- New files land under the structure in architecture.md:208-219: `apps/api/src/modules/auth/{auth.routes,auth.controller,auth.service}.ts`, `apps/api/src/middleware/error.ts`, `apps/api/src/lib/app-error.ts`; shared schema in `packages/shared/src/auth.ts`.
- No `apps/web` work in this story (the sign-up form/page is a later UI task; this story is the API + shared schema).

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.2] (user story + ACs)
- [Source: _bmad-output/planning-artifacts/architecture.md#Authentication & Security] (argon2id params, JWT deferred to 1.3)
- [Source: _bmad-output/planning-artifacts/architecture.md#API & Format Patterns] (REST, error contract, casing)
- [Source: CLAUDE.md] (PIPEDA consent; no PII logged; Zod at boundary; import types from @clarifi/shared)
- [Source: packages/shared/prisma/schema.prisma:95] (User model — reuse as-is)
- [Source: packages/shared/src/prisma.ts] (base `prisma` client; `withUserContext` — NOT used for signup)
- [Source: packages/shared/prisma/migrations/0004_review_hardening/migration.sql] (narrowed users INSERT policy enables signup with no context)
- [Source: apps/api/src/app.ts] (createApp — mount /auth + error mw here)

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m]

### Debug Log References

- `pnpm -r test` initially flaked on the api duplicate-email test: pnpm runs workspace packages in parallel, so the shared RLS suite and api auth suite opened interactive transactions against the same Supabase free-tier instance simultaneously → connection/transaction contention. Fixed by adding `.npmrc` `workspace-concurrency=1` (serial workspace script execution).
- After serializing, the api test still flaked + ran ~11s because `auth.service.test.ts` used `prisma.$disconnect()` in `afterEach`, forcing a slow/flaky reconnect through the Supabase pooler between tests. Fixed by moving cleanup + disconnect to `afterAll` (the proven pattern from Story 1.1's `rls.test.ts`) and trimming the duplicate test to a single extra `registerUser` call. Two consecutive `pnpm -r test` runs are now green.

### Completion Notes List

- All 5 ACs satisfied. `POST /auth/register` validates with the shared `RegisterInput` Zod schema, hashes with argon2id (t=3, m=64MiB, p=1), creates a PIPEDA-consented `User`, and returns `201 { id, email, consentedAt }` (no `passwordHash`).
- Reused the existing `User` model and base `prisma` client; **no schema change / no migration** this story (per Dev Notes). Registration deliberately uses the base client, not `withUserContext` — signup has no user context yet, and migration `0004` permits the no-context INSERT. Documented in `auth.service.ts`.
- Established the reusable API error contract (`AppError` + central `errorMiddleware`) — `400 VALIDATION_ERROR` (ZodError), `409 EMAIL_TAKEN`, `500 INTERNAL` (generic, no internal leak). All later route stories reuse it.
- Tests: 6 pure schema units (`auth.test.ts`), 4 error-middleware units (`error.test.ts`, no DB), 2 DB-gated integration tests (`auth.service.test.ts`, skip without `DATABASE_URL`). Full suite: shared 20/20, api 6/6; `pnpm -r typecheck` clean.
- Added deps: `argon2` (dep, apps/api), `dotenv` (devDep, apps/api — for the vitest root-`.env` loader, mirroring `packages/shared`).
- Scope held: no JWT/login (Story 1.3), no web sign-up UI.

### File List

- `packages/shared/src/auth.ts` (new — `RegisterInput` Zod schema)
- `packages/shared/src/auth.test.ts` (new — schema units)
- `packages/shared/src/index.ts` (modified — export `./auth.js`)
- `apps/api/src/lib/app-error.ts` (new — `AppError` + `badRequest`/`conflict`)
- `apps/api/src/middleware/error.ts` (new — central error contract middleware)
- `apps/api/src/middleware/error.test.ts` (new — middleware units)
- `apps/api/src/modules/auth/auth.service.ts` (new — `registerUser` + argon2id)
- `apps/api/src/modules/auth/auth.controller.ts` (new — `register` handler)
- `apps/api/src/modules/auth/auth.routes.ts` (new — `authRouter`, `POST /register`)
- `apps/api/src/modules/auth/auth.service.test.ts` (new — DB-gated integration)
- `apps/api/src/app.ts` (modified — mount `/auth` + error middleware)
- `apps/api/vitest.config.ts` (new — loads root `.env`, serial)
- `apps/api/package.json` (modified — add `argon2` dep, `dotenv` devDep)
- `.npmrc` (new — `workspace-concurrency=1` for deterministic DB tests)
- `apps/api/src/modules/auth/auth.routes.test.ts` (new — review patch: HTTP e2e suite via supertest)
- `pnpm-lock.yaml` (modified — new deps incl. `supertest`/`@types/supertest` from review)

## Change Log

- 2026-06-15: Story created (ready-for-dev). Comprehensive context engineered from epics, architecture, Story 1.1 learnings, and the live API scaffold.
- 2026-06-15: Implemented Story 1.2 — shared `RegisterInput` schema, API error contract, `POST /auth/register` with argon2id hashing + PIPEDA consent, and tests (26/26 across the repo). Added `.npmrc` serial workspace execution to keep the shared-DB test suites deterministic. Status → review.
- 2026-06-15: Code review applied — 4 patches (body-parser 4xx mapping + pino ordering, email `.max(254)`, error-contract details omission, supertest e2e suite); 4 deferred, 8 dismissed. Added `supertest` devDep + `auth.routes.test.ts`. Full suite 35/35 (shared 22, api 13) green over two runs; typecheck clean. Status → done.
